import json

from prisma import Prisma

from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.models import TaskCommand, WorkspaceTask

MANAGEMENT_OPERATIONS = {
    "edit",
    "reparent",
    "assign",
    "cancel",
    "reopen",
    "pause",
    "resume",
    "retry",
}


async def authorize_task_manager(
    tx: Prisma,
    user_id: str,
    session_id: str,
    tasks: list[WorkspaceTask],
    command: TaskCommand,
) -> None:
    session = await tx.chatsession.find_first(
        where={"id": session_id, "userId": user_id}
    )
    if not session or session.expertId:
        raise TaskConflict("Only AutoPilot can manage tasks across your workspace")
    linked_id = json.loads(json.dumps(session.metadata)).get("workspace_task_id")
    if linked_id and not any(task.session_id == session_id for task in tasks):
        raise TaskConflict("This conversation no longer manages its former task")
    if command.operation not in MANAGEMENT_OPERATIONS:
        raise TaskConflict("This operation is not available through task management")
