from datetime import UTC, datetime
from uuid import uuid4

from backend.api.features.tasks.agent_steps import (
    add_workspace_task_step as add_workspace_task_step,
)
from backend.api.features.tasks.agent_steps import (
    assign_workspace_task_step as assign_workspace_task_step,
)
from backend.api.features.tasks.commands import apply_command
from backend.api.features.tasks.domain import TaskConflict, is_runnable, record
from backend.api.features.tasks.lifecycle import (
    workspace_task_for_session as workspace_task_for_session,
)
from backend.api.features.tasks.lifecycle import (
    workspace_task_run_event as workspace_task_run_event,
)
from backend.api.features.tasks.models import TaskCommand, TaskCreate, WorkspaceTask
from backend.api.features.tasks.planning_db import (
    accept_workspace_task_breakdown as accept_workspace_task_breakdown,
)
from backend.api.features.tasks.planning_db import (
    begin_workspace_task_breakdown as begin_workspace_task_breakdown,
)
from backend.api.features.tasks.planning_db import (
    begin_workspace_task_suggestion as begin_workspace_task_suggestion,
)
from backend.api.features.tasks.planning_db import (
    finish_workspace_task_breakdown as finish_workspace_task_breakdown,
)
from backend.api.features.tasks.planning_db import (
    finish_workspace_task_suggestion as finish_workspace_task_suggestion,
)
from backend.api.features.tasks.planning_inputs import (
    workspace_task_planning_inputs as workspace_task_planning_inputs,
)
from backend.api.features.tasks.planning_refresh_db import (
    reconsider_workspace_task_plans as reconsider_workspace_task_plans,
)
from backend.api.features.tasks.planning_refresh_db import (
    workspace_task_planning_users as workspace_task_planning_users,
)
from backend.api.features.tasks.question_sync import sync_task_question
from backend.api.features.tasks.repository import (
    _decode,
    _get,
    _load,
    _lock,
    _prepare_dispatches,
    _save,
)
from backend.api.features.tasks.run_authority import (
    start_workspace_task_run as start_workspace_task_run,
)
from backend.api.features.tasks.schedule_db import (
    configure_workspace_task_schedule as configure_workspace_task_schedule,
)
from backend.api.features.tasks.schedule_db import (
    create_workspace_task_occurrence as create_workspace_task_occurrence,
)
from backend.data.db import prisma


async def list_workspace_tasks(user_id: str) -> list[WorkspaceTask]:
    return await _load(prisma, user_id)


async def create_workspace_task(
    user_id: str,
    request: TaskCreate,
    organization_id: str | None = None,
    source_session_id: str | None = None,
) -> WorkspaceTask:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        existing = next((t for t in tasks if t.id == request.id), None)
        if existing:
            return existing
        if len(tasks) >= 1000:
            raise TaskConflict("This workspace has reached 1,000 tasks")
        parent = _get(tasks, request.parent_id) if request.parent_id else None
        task = WorkspaceTask(
            **request.model_dump(),
            user_id=user_id,
            organization_id=organization_id,
            source_session_id=source_session_id
        )
        if parent:
            task.organization_id = parent.organization_id
            task.project = task.project or parent.project
            if parent.status in ("done", "canceled"):
                raise TaskConflict("Reopen the outcome before adding steps")
        record(task, user_id, "Task captured")
        await _save(tx, task)
        return task


async def command_workspace_task(
    user_id: str,
    task_id: str,
    command: TaskCommand,
    actor: str | None = None,
    manager_session_id: str | None = None,
) -> WorkspaceTask:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        task = _get(tasks, task_id)
        if manager_session_id:
            from backend.api.features.tasks.management import authorize_task_manager

            await authorize_task_manager(
                tx, user_id, manager_session_id, tasks, command
            )
            actor = "AutoPilot"
        apply_command(task, command, tasks, actor)
        if command.operation in ("edit", "reparent"):
            from backend.api.features.tasks.domain import branch

            for member in branch(task.id, tasks):
                if not member.assignee:
                    member.suggestion, member.suggestion_alternatives = None, []
                    member.suggestion_state, member.suggestion_request_id = "idle", ""

        if command.operation != "suggest":
            _prepare_dispatches(tasks)
        for changed in tasks:
            if (
                command.operation in ("answer", "complete", "submit_result", "cancel")
                and changed.question
            ):
                if changed.id == task.id or changed.status in ("done", "canceled"):
                    await sync_task_question(tx, changed)
            await _save(tx, changed)
        return task


async def claim_workspace_task_dispatch(
    user_id: str, task_id: str
) -> WorkspaceTask | None:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        task = _get(tasks, task_id)
        if task.dispatch_state != "pending" or not is_runnable(task, tasks):
            return None
        task.dispatch_state = "claimed"
        task.dispatch_claimed_at = datetime.now(UTC)
        claimed = task.model_copy(deep=True)
        task.dispatch_message = ""
        await _save(tx, task)
        return claimed


async def update_workspace_task_dispatch(
    user_id: str,
    task_id: str,
    dispatch_id: str,
    state: str,
    error: str = "",
    message: str = "",
) -> None:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        task = _get(await _load(tx, user_id), task_id)
        if task.dispatch_id != dispatch_id or task.dispatch_state != "claimed":
            return
        if state == "sent":
            task.dispatch_state = "sent"
            if task.status != "working":
                task.activity = "Queued for an available worker"
        elif state == "pending":
            task.dispatch_message = message
            task.dispatch_state, task.activity = "pending", error
        else:
            task.dispatch_message = message
            task.dispatch_state, task.status, task.activity = (
                "finished",
                "blocked",
                error,
            )
        record(task, "Auto", task.activity)
        await _save(tx, task)


async def bind_workspace_task_session(user_id: str, task_id: str) -> WorkspaceTask:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        task = _get(await _load(tx, user_id), task_id)
        if not task.session_id:
            task.session_id = str(uuid4())
            await _save(tx, task)
        return task


async def pending_workspace_task_dispatches() -> list[WorkspaceTask]:
    rows = await prisma.workspacetask.find_many(
        where={"dispatchState": "pending"}, take=100, order={"updatedAt": "asc"}
    )
    return [_decode(row.payload) for row in rows]


async def unfinished_workspace_task_dispatches() -> list[WorkspaceTask]:
    rows = await prisma.workspacetask.find_many(
        where={"dispatchState": {"in": ["claimed", "sent"]}},
        take=100,
        order={"updatedAt": "asc"},
    )
    return [_decode(row.payload) for row in rows]
