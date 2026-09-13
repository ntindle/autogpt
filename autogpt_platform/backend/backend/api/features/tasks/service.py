import logging

from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.models import TaskAssignee, TaskCommand, WorkspaceTask
from backend.copilot.active_turns import ConcurrentTurnLimitError
from backend.copilot.builder_context import resolve_session_permissions
from backend.copilot.config import ChatConfig
from backend.copilot.executor.utils import enqueue_cancel_task, schedule_chat_turn
from backend.copilot.model import (
    create_chat_session,
    get_chat_session,
    update_session_title,
)
from backend.copilot.pending_message_helpers import is_turn_in_flight
from backend.copilot.rate_limit import (
    check_rate_limit,
    enforce_payment_paywall,
    get_global_rate_limits,
)
from backend.copilot.transports import resolve_default_chat_route
from backend.data.db_accessors import experts_db, tasks_db
from backend.integrations.codex.access import enforce_codex_access_http
from backend.util.exceptions import NotFoundError

logger = logging.getLogger(__name__)


async def task_assignees(user_id: str) -> list[TaskAssignee]:
    experts = await experts_db().list_experts(user_id, with_metrics=False)
    return [
        TaskAssignee(kind="human", id=user_id, name="You"),
        TaskAssignee(kind="auto", id="auto", name="AutoPilot"),
        *[
            TaskAssignee(
                kind="expert",
                id=e.id,
                name=e.name,
                avatar_url=e.avatar_url,
                reason=e.role,
                role=e.role,
                color=e.color,
            )
            for e in experts
            if not e.schedules_paused_at
        ],
    ]


async def execute_task_command(
    user_id: str,
    task_id: str,
    command: TaskCommand,
    manager_session_id: str | None = None,
) -> WorkspaceTask:
    if command.question_target:
        candidates = await task_assignees(user_id)
        target = next(
            (
                a
                for a in candidates
                if (a.kind, a.id)
                == (command.question_target.kind, command.question_target.id)
            ),
            None,
        )
        if target is None:
            raise NotFoundError("Question recipient is not available in your workspace")
        command.question_target = target
    if command.assignee:
        candidates = await task_assignees(user_id)
        assignee = next(
            (
                a
                for a in candidates
                if a.kind == command.assignee.kind and a.id == command.assignee.id
            ),
            None,
        )
        if assignee is None:
            raise NotFoundError("Assignee not available in your workspace")
        command.assignee = assignee
    previous = (
        await tasks_db().list_workspace_tasks(user_id)
        if command.operation == "route_question"
        else []
    )
    task = await tasks_db().command_workspace_task(
        user_id, task_id, command, manager_session_id=manager_session_id
    )
    if previous:
        current = await tasks_db().list_workspace_tasks(user_id)
        for old in previous:
            if (
                old.session_id
                and old.dispatch_state in ("sent", "claimed")
                and any(t.id == old.id and t.status == "canceled" for t in current)
            ):
                await enqueue_cancel_task(old.session_id)
    if command.operation == "pause" and task.session_id:
        await enqueue_cancel_task(task.session_id)
    if command.operation == "discuss":
        task = await tasks_db().bind_workspace_task_session(user_id, task_id)
        await ensure_task_session(task)
    await dispatch_user_tasks(user_id)
    return next(
        t for t in await tasks_db().list_workspace_tasks(user_id) if t.id == task_id
    )


async def ensure_task_session(task: WorkspaceTask):
    if not task.session_id:
        raise TaskConflict("No conversation is linked")
    session = await get_chat_session(task.session_id, task.user_id)
    if session:
        return session
    provider, credential = await resolve_default_chat_route(task.user_id)
    session = await create_chat_session(
        task.user_id,
        session_id=task.session_id,
        dry_run=False,
        workspace_task_id=task.id,
        expert_id=(
            task.assignee.id
            if task.assignee and task.assignee.kind == "expert"
            else None
        ),
        organization_id=task.organization_id,
        origin="interactive",
        llm_auth_provider=provider,
        llm_credential_id=credential,
    )

    await update_session_title(
        session.session_id, task.user_id, task.title, only_if_empty=True
    )
    return session


async def dispatch_user_tasks(user_id: str) -> None:
    for task in await tasks_db().list_workspace_tasks(user_id):
        if task.dispatch_state == "pending":
            await dispatch_task(task)


async def dispatch_task(task: WorkspaceTask) -> None:
    if task.session_id and await is_turn_in_flight(task.session_id):
        return
    claimed = await tasks_db().claim_workspace_task_dispatch(task.user_id, task.id)
    if not claimed or not claimed.dispatch_id:
        return
    try:
        session = await ensure_task_session(claimed)
        await _admit(session.user_id, session.metadata.llm_auth_provider)
        await schedule_chat_turn(
            session_id=session.session_id,
            user_id=claimed.user_id,
            message=claimed.dispatch_message or task_prompt(claimed),
            message_id=claimed.dispatch_id,
            organization_id=session.organization_id,
            team_id=session.team_id,
            llm_auth_provider=session.metadata.llm_auth_provider,
            llm_credential_id=session.metadata.llm_credential_id,
            permissions=resolve_session_permissions(session),
        )
        await tasks_db().update_workspace_task_dispatch(
            claimed.user_id, claimed.id, claimed.dispatch_id, "sent"
        )
    except ConcurrentTurnLimitError:
        await tasks_db().update_workspace_task_dispatch(
            claimed.user_id,
            claimed.id,
            claimed.dispatch_id,
            "pending",
            "Waiting for an available execution slot",
            claimed.dispatch_message,
        )
    except Exception as exc:
        logger.exception("Task dispatch failed for %s", claimed.id)
        await tasks_db().update_workspace_task_dispatch(
            claimed.user_id,
            claimed.id,
            claimed.dispatch_id,
            "failed",
            f"Could not start: {str(exc)[:300] or type(exc).__name__}. Open chat to resolve, then retry.",
            claimed.dispatch_message,
        )


async def _admit(user_id: str, provider: str) -> None:
    if provider == "codex":
        await enforce_codex_access_http(user_id)
    elif provider == "platform":
        await enforce_payment_paywall(user_id)
        config = ChatConfig()
        daily, weekly, _ = await get_global_rate_limits(
            user_id,
            config.daily_cost_limit_microdollars,
            config.weekly_cost_limit_microdollars,
        )
        await check_rate_limit(
            user_id=user_id, daily_cost_limit=daily, weekly_cost_limit=weekly
        )


def task_prompt(task: WorkspaceTask) -> str:
    return (
        (
            "You are answering a teammate question, not executing its underlying task. Submit advice with manage_tasks submit_result; the reply returns automatically.\n"
            if task.question_for
            else ""
        )
        + f"You own this task: {task.title}\n\n{task.description}\n"
        f"Project context: {task.project or 'None'}\nTask ID: {task.id}\n\n"
        "Work toward the actual outcome using your existing permissions. Use manage_tasks to inspect the shared task and necessary steps. "
        "Keep task granularity useful; tool calls are not subtasks. Keep human decisions and physical actions with the user, and respect planning holds. AutoPilot may reroute existing tasks with manage_tasks assign or reparent; preserve their records and stop active attempts before reassigning. "
        "AutoPilot coordinates the outcome: reject unnecessary scope, ask for evidence, and prefer the smallest sufficient approach. "
        "Use ask_question with a recipient for missing information: target_kind auto for the coordinator, expert plus target_id from list_team for specialty questions, human for user decisions. Mark approvals with purpose approval and account setup with purpose account_setup; they stay with the user. Keep the task owner while asking a teammate; do not duplicate its deliverable. Continue independent steps when possible. "
        "Use manage_tasks with operation submit_result and evidence when the deliverable is ready. Include Markdown links [filename](workspace://file_id) for workspace deliverables, using actual IDs returned by write_workspace_file or list_workspace_files. Ending a chat does not complete the task. "
        "Never treat a plan or instructions as proof that the requested action happened. Acceptance of a draft does not authorize publication."
    )
