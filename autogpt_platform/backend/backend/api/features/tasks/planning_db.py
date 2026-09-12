import json
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, uuid4, uuid5

from prisma import Json

from backend.api.features.tasks.domain import (
    TaskConflict,
    ancestors,
    can_edit_execution,
    check_structure,
    record,
)
from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskBreakdown,
    TaskBreakdownAccept,
    TaskBreakdownRequest,
    TaskBreakdownStep,
    WorkspaceTask,
)
from backend.api.features.tasks.planning_inputs import (
    load_planning_environment,
    task_planning_inputs,
)
from backend.api.features.tasks.repository import (
    _get,
    _load,
    _lock,
    _prepare_dispatches,
    _save,
)
from backend.data.db import prisma


async def begin_workspace_task_suggestion(
    user_id: str, task_id: str, force: bool = False
) -> WorkspaceTask | None:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        task = _get(tasks, task_id)
        if task.assignee or task.status in ("done", "canceled") or task.review_of:
            return None
        recent = (
            task.suggestion_started_at
            and task.suggestion_started_at > datetime.now(UTC) - timedelta(minutes=2)
        )
        if task.suggestion_state == "pending" and recent:
            return None
        inputs = await _planning_inputs(tx, task, tasks)
        if not force and inputs.busy:
            return None
        if (
            not force
            and task.suggestion_state in ("ready", "error")
            and task.suggestion_context == inputs.fingerprint
        ):
            return None
        start_suggestion(task, inputs.fingerprint)
        await _save(tx, task)
        return task


async def finish_workspace_task_suggestion(
    user_id: str,
    task_id: str,
    request_id: str,
    suggestion: TaskAssignee | None,
    alternatives: list[TaskAssignee],
    error: str = "",
) -> None:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        task = _get(tasks, task_id)
        if task.assignee or task.suggestion_request_id != request_id:
            return
        inputs = await _planning_inputs(tx, task, tasks)
        if task.suggestion_context != inputs.fingerprint:
            task.suggestion_state = "idle"
        else:
            task.suggestion, task.suggestion_alternatives = suggestion, alternatives
            task.suggestion_state = "error" if error else "ready"
            task.suggestion_error = error
        await _save(tx, task)


async def begin_workspace_task_breakdown(
    user_id: str, task_id: str, request: TaskBreakdownRequest
) -> WorkspaceTask:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        task = _get(tasks, task_id)
        if task.status == "canceled" or task.review_of or task.schedule:
            raise TaskConflict("Break down an active task or a schedule occurrence")
        inputs = await _planning_inputs(tx, task, tasks)
        task.breakdown = TaskBreakdown(
            context=inputs.fingerprint, **request.model_dump()
        )
        task.breakdown_refresh = None
        await _save(tx, task)
        return task


async def finish_workspace_task_breakdown(
    user_id: str,
    task_id: str,
    preview_id: str,
    steps: list[TaskBreakdownStep],
    error: str = "",
) -> None:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        task = _get(tasks, task_id)
        automatic = bool(
            task.breakdown_refresh and task.breakdown_refresh.id == preview_id
        )
        preview = task.breakdown_refresh if automatic else task.breakdown
        if not preview or preview.id != preview_id or preview.state != "pending":
            return
        if automatic and (
            task.assignee
            or task.status in ("done", "canceled")
            or not task.breakdown
            or task.breakdown.state == "accepted"
        ):
            task.breakdown_refresh = None
            await _save(tx, task)
            return
        inputs = await _planning_inputs(tx, task, tasks)
        if preview.context != inputs.fingerprint:
            if automatic:
                task.breakdown_refresh = None
                await _save(tx, task)
                return
            error = "The task changed while planning. Generate a fresh breakdown."
        preview.state, preview.error = ("error" if error else "ready"), error
        preview.steps = steps if not error else []
        if automatic and not error:
            task.breakdown, task.breakdown_refresh = preview, None
        await _save(tx, task)


async def accept_workspace_task_breakdown(
    user_id: str, task_id: str, request: TaskBreakdownAccept
) -> WorkspaceTask:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        task = _get(tasks, task_id)
        preview = task.breakdown
        if not preview or preview.id != request.preview_id:
            raise TaskConflict(
                "This breakdown was replaced. Review the latest preview."
            )
        if preview.state == "accepted":
            return task
        inputs = await _planning_inputs(tx, task, tasks)
        if preview.state != "ready" or preview.context != inputs.fingerprint:
            raise TaskConflict(
                "The task changed. Generate a fresh breakdown before accepting."
            )
        can_edit_execution(task)
        proposed = {step.id: step for step in preview.steps}
        selected = {step.id for step in request.steps}
        if len(selected) != len(request.steps) or not selected <= proposed.keys():
            raise TaskConflict("Select unique steps from this preview")
        for selection in request.steps:
            if any(d not in selected for d in proposed[selection.id].dependencies):
                raise TaskConflict(
                    "Include the prerequisite steps, or generate a plan without them"
                )
        if len(tasks) + len(selected) + 1 > 1000:
            raise TaskConflict("This workspace has reached 1,000 tasks")
        delegated = bool(
            task.assignee and task.assignee.kind != "human" and task.accepted
        )
        if not any(t.parent_id == task.id for t in tasks) and (
            task.status != "todo" or task.result or task.question or task.last_turn_id
        ):
            await _preserve_leaf_work(tx, task, tasks, preview.id)
        for selection in request.steps:
            step = proposed[selection.id]
            child = WorkspaceTask(
                id=step.id,
                user_id=user_id,
                organization_id=task.organization_id,
                title=selection.title,
                description=step.description,
                parent_id=task.id,
                project=task.project,
                assignee=selection.assignee if delegated else None,
                suggestion=selection.assignee if not delegated else None,
                suggestion_state=(
                    "ready" if selection.assignee and not delegated else "idle"
                ),
                dependencies=list(step.dependencies),
            )
            record(
                child,
                user_id,
                (
                    "Accepted a breakdown step"
                    if delegated
                    else "Added a planned step; ownership is suggested"
                ),
            )
            tasks.append(child)
            check_structure(child, tasks)
        preview.state = "accepted"
        task.breakdown_refresh = None
        record(
            task,
            user_id,
            f"Accepted {len(selected)} breakdown steps; kept existing work",
        )
        _prepare_dispatches(tasks)
        for changed in tasks:
            await _save(tx, changed)
        return task


async def _preserve_leaf_work(
    tx, task: WorkspaceTask, tasks: list[WorkspaceTask], preview_id: str
) -> None:
    checkpoint = task.model_copy(deep=True)
    checkpoint.id = str(uuid5(NAMESPACE_URL, f"task-breakdown:{preview_id}:original"))
    checkpoint.title = (
        "Accepted result: " if task.status == "done" else "Original task: "
    ) + task.title[:480]
    checkpoint.parent_id, checkpoint.breakdown = task.id, None
    checkpoint.plan_only = False
    tasks.append(checkpoint)
    for review in tasks:
        if review.review_of == task.id:
            review.review_of = checkpoint.id
            record(review, task.user_id, "Original result preserved as a step")
    if task.session_id:
        session = await tx.chatsession.find_unique(where={"id": task.session_id})
        if session and session.userId == task.user_id:
            metadata = json.loads(json.dumps(session.metadata))
            metadata["workspace_task_id"] = checkpoint.id
            await tx.chatsession.update(
                where={"id": session.id}, data={"metadata": Json(metadata)}
            )
    task.session_id, task.started_turn_ids, task.last_turn_id = None, [], None
    task.status, task.activity = "todo", "Coordinating the expanded outcome"
    task.question, task.result, task.result_version = None, None, 0
    task.dispatch_id, task.dispatch_state, task.dispatch_claimed_at = None, None, None
    task.dispatch_message, task.coordination_state = "", ""


def start_suggestion(task: WorkspaceTask, fingerprint: str) -> None:
    task.suggestion_request_id = str(uuid4())
    task.suggestion_context = fingerprint
    task.suggestion_state, task.suggestion_error = "pending", ""
    task.suggestion_started_at = datetime.now(UTC)
    task.suggestion, task.suggestion_alternatives = None, []


async def _planning_inputs(tx, task: WorkspaceTask, tasks: list[WorkspaceTask]):
    environment = await load_planning_environment(
        tx, task.user_id, ancestors(task, tasks)
    )
    return task_planning_inputs(task, tasks, environment)
