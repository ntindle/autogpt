from uuid import NAMESPACE_URL, uuid5

from backend.api.features.tasks.domain import TaskConflict, ancestors, record
from backend.api.features.tasks.models import TaskAssignee, TaskQuestion, WorkspaceTask
from backend.api.features.tasks.repository import (
    _load,
    _lock,
    _prepare_dispatches,
    _save,
)
from backend.data.db import prisma


async def workspace_task_for_session(
    user_id: str, session_id: str
) -> WorkspaceTask | None:
    return next(
        (t for t in await _load(prisma, user_id) if t.session_id == session_id), None
    )


async def workspace_task_run_event(
    user_id: str,
    session_id: str,
    event: str,
    text: str = "",
    question: TaskQuestion | None = None,
    turn_id: str | None = None,
) -> WorkspaceTask | None:
    row = await prisma.workspacetask.find_first(
        where={"userId": user_id, "sessionId": session_id}
    )
    if row is None:
        return None
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        task = next((t for t in tasks if t.session_id == session_id), None)
        if (
            task is None
            or task.status in ("done", "canceled")
            or (turn_id and task.last_turn_id != turn_id)
        ):
            return task
        if (
            event in ("started", "finished")
            and not task.dispatch_state
            and task.status == "todo"
        ):
            return task
        if event == "started":
            task.status, task.activity = "working", "Working on your task"
        elif event == "question" and question:
            task.question = question
            task.status, task.activity = "needs_you", "Waiting for your answer"
        elif event == "result" and text:
            _submit_result(task, tasks, text)
        elif event == "finished":
            task.dispatch_state = "finished"
            if task.question and task.question.answers is None:
                task.status, task.activity = "needs_you", "Waiting for your answer"
            elif (
                task.question
                and task.question.answers is not None
                and task.dispatch_message
            ):
                task.status, task.dispatch_state = "todo", "pending"
            elif task.result and task.status == "needs_you":
                pass
            else:
                task.status = "blocked"
                task.activity = text or (
                    "Paused"
                    if task.paused
                    else "Attempt ended without an accepted result. Open the chat or retry."
                )
        elif event == "activity":
            task.activity = text[:500]
        record(task, task.assignee.name if task.assignee else "Auto", task.activity)
        _prepare_dispatches(tasks)
        for changed in tasks:
            await _save(tx, changed)
        return task


def _submit_result(task: WorkspaceTask, tasks: list[WorkspaceTask], text: str) -> None:
    if (
        not task.assignee
        or task.assignee.kind == "human"
        or task.schedule
        or any(
            item.plan_only or item.paused or not item.accepted
            for item in ancestors(task, tasks)
        )
    ):
        raise TaskConflict("This task is not delegated for execution")
    if task.result == text and task.status == "needs_you":
        return
    for review in tasks:
        if review.review_of == task.id and review.status not in ("done", "canceled"):
            review.status = "canceled"
            record(review, "Auto", "Superseded by a newer result")
    task.result = text
    task.result_version += 1
    task.status, task.activity = "needs_you", "Result ready for review"
    task.question = None
    review_id = str(
        uuid5(NAMESPACE_URL, f"autogpt-task-review:{task.id}:{task.result_version}")
    )
    review = WorkspaceTask(
        id=review_id,
        user_id=task.user_id,
        organization_id=task.organization_id,
        title=f"Approve {task.title}"[:500],
        parent_id=task.parent_id,
        project=task.project,
        status="needs_you",
        activity="Review the submitted result",
        assignee=TaskAssignee(kind="human", id=task.user_id, name="You"),
        review_of=task.id,
        review_version=task.result_version,
    )
    tasks.append(review)
    record(
        review,
        "Auto",
        "Acceptance requested; this does not authorize further external actions",
    )
