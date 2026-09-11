import json
from uuid import uuid4

from prisma import Json, Prisma

from backend.api.features.tasks.domain import is_runnable, record
from backend.api.features.tasks.models import WorkspaceTask
from backend.util.exceptions import NotFoundError


def _prepare_dispatches(tasks: list[WorkspaceTask]) -> None:
    for task in tasks:
        children = [
            child
            for child in tasks
            if child.parent_id == task.id
            and child.accepted
            and not child.review_of
            and (
                child.status == "done"
                or (
                    child.result
                    and child.status == "needs_you"
                    and child.dispatch_state == "finished"
                )
            )
        ]
        state = json.dumps(
            sorted((child.id, child.status, child.result_version) for child in children)
        )
        if (
            children
            and task.assignee
            and task.assignee.kind == "auto"
            and task.status == "blocked"
            and task.dispatch_state == "finished"
            and state != task.coordination_state
        ):
            task.coordination_state = state
            task.status, task.dispatch_state = "todo", None
            task.dispatch_message = "Child work has changed. Inspect your branch with manage_tasks, review any submitted child results, and continue coordinating the delegated outcome."
        if not is_runnable(task, tasks) or task.dispatch_state == "pending":
            continue
        task.status = "todo"
        task.dispatch_id = str(uuid4())
        task.session_id = task.session_id or str(uuid4())
        task.dispatch_state, task.activity = "pending", "Queued"
        record(task, "Auto", "Delegated work queued")


async def _load(tx: Prisma, user_id: str) -> list[WorkspaceTask]:
    rows = await tx.workspacetask.find_many(
        where={"userId": user_id}, order={"createdAt": "asc"}
    )
    return sorted(
        (_decode(row.payload) for row in rows),
        key=lambda task: (task.created_at, task.id),
    )


def _decode(payload: Json) -> WorkspaceTask:
    return WorkspaceTask.model_validate_json(json.dumps(payload))


def _get(tasks: list[WorkspaceTask], task_id: str) -> WorkspaceTask:
    task = next((t for t in tasks if t.id == task_id), None)
    if task is None:
        raise NotFoundError("Task not found")
    return task


async def _lock(tx: Prisma, user_id: str) -> None:
    await tx.execute_raw(
        "SELECT pg_advisory_xact_lock(hashtext($1))", f"workspace-tasks:{user_id}"
    )


async def _save(tx: Prisma, task: WorkspaceTask) -> None:
    payload = Json(task.model_dump(mode="json"))
    await tx.workspacetask.upsert(
        where={"id_userId": {"id": task.id, "userId": task.user_id}},
        data={
            "create": {
                "id": task.id,
                "userId": task.user_id,
                "payload": payload,
                "sessionId": task.session_id,
                "dispatchState": task.dispatch_state,
            },
            "update": {
                "payload": payload,
                "sessionId": task.session_id,
                "dispatchState": task.dispatch_state,
            },
        },
    )
