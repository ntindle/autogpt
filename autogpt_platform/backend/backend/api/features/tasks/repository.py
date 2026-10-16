import json
from uuid import uuid4

from prisma import Json, Prisma
from prisma.types import WorkspaceTaskCreateInput

from backend.api.features.tasks.domain import TaskConflict, is_runnable, record
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
        if not is_runnable(task, tasks):
            if task.dispatch_state == "pending":
                task.dispatch_state = None
                task.activity = (
                    "Waiting for execution to be enabled or prerequisites to finish"
                )
            continue
        if task.dispatch_state == "pending":
            continue
        task.status = "todo"
        task.dispatch_id = str(uuid4())
        task.session_id = task.session_id or str(uuid4())
        task.dispatch_state, task.activity = "pending", "Queued"
        record(task, "Auto", "Delegated work queued")


async def organization_scope(
    tx: Prisma, user_id: str, organization_id: str | None
) -> list[str | None]:
    personal = await tx.organization.find_first(
        where={"bootstrapUserId": user_id, "isPersonal": True, "deletedAt": None}
    )
    if organization_id is None or (personal and organization_id == personal.id):
        return [personal.id, None] if personal else [None]
    return [organization_id]


async def _load(
    tx: Prisma, user_id: str, organization_id: str | None = None
) -> list[WorkspaceTask]:
    scope = await organization_scope(tx, user_id, organization_id)
    rows = await tx.workspacetask.find_many(
        where={"userId": user_id}, order={"createdAt": "asc"}
    )
    return sorted(
        (
            task
            for row in rows
            if (task := _decode(row.payload)).organization_id in scope
        ),
        key=lambda task: (task.created_at, task.id),
    )


def _decode(payload: Json) -> WorkspaceTask:
    return WorkspaceTask.model_validate_json(json.dumps(payload))


async def session_organization(tx: Prisma, user_id: str, session_id: str) -> str | None:
    session = await tx.chatsession.find_first(
        where={"id": session_id, "userId": user_id}
    )
    row = await tx.workspacetask.find_first(
        where={"userId": user_id, "sessionId": session_id}
    )
    if row:
        task = _decode(row.payload)
        if session and task.organization_id not in await organization_scope(
            tx, user_id, session.organizationId
        ):
            raise NotFoundError("Task conversation not found")
        return task.organization_id
    if session:
        return session.organizationId
    raise TaskConflict("Conversation not found in your workspace")


async def _load_for_session(
    tx: Prisma, user_id: str, session_id: str
) -> list[WorkspaceTask]:
    return await _load(tx, user_id, await session_organization(tx, user_id, session_id))


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
    existing = await tx.workspacetask.find_unique(
        where={"id_userId": {"id": task.id, "userId": task.user_id}}
    )
    if existing and _decode(existing.payload).organization_id != task.organization_id:
        raise NotFoundError("Task not found")
    payload = Json(task.model_dump(mode="json"))
    create = WorkspaceTaskCreateInput(
        id=task.id,
        userId=task.user_id,
        payload=payload,
        sessionId=task.session_id,
        dispatchState=task.dispatch_state,
    )
    await tx.workspacetask.upsert(
        where={"id_userId": {"id": task.id, "userId": task.user_id}},
        data={
            "create": create,
            "update": {
                "payload": payload,
                "sessionId": task.session_id,
                "dispatchState": task.dispatch_state,
            },
        },
    )
