from backend.api.features.tasks.context import execution_context
from backend.copilot.model import ChatSession
from backend.copilot.permissions import CopilotPermissions
from backend.data.db_accessors import tasks_db


async def task_execution_policy(
    session: ChatSession, permissions: CopilotPermissions | None, turn_id: str
) -> tuple[CopilotPermissions | None, str]:
    if not session.metadata.workspace_task_id or not session.user_id:
        return permissions, ""
    authority = await tasks_db().start_workspace_task_run(
        session.user_id, session.session_id, turn_id
    )
    if authority.duplicate_turn:
        raise RuntimeError(
            "This task turn was already claimed; retry with a new attempt if needed"
        )
    if not authority.task:
        return permissions, (
            "The linked task is unavailable. Discuss the user's request with your normally "
            "authorized tools, but do not assume delegation from the missing task."
        )
    return permissions, execution_context(
        authority.task, await tasks_db().list_workspace_tasks(session.user_id)
    )
