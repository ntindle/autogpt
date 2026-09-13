from backend.api.features.tasks.context import execution_context
from backend.copilot.model import ChatSession
from backend.data.db_accessors import tasks_db


async def task_context_block(
    session: ChatSession, context: dict[str, str] | None = None
) -> str:
    brief = (context or {}).get("workspace_task", "")
    if not brief and session.metadata.workspace_task_id and session.user_id:
        tasks = await tasks_db().list_workspace_tasks(session.user_id)
        task = next((t for t in tasks if t.session_id == session.session_id), None)
        brief = (
            execution_context(task, tasks)
            if task
            else "The linked task is unavailable; do not assume task delegation."
        )
    if not brief:
        return ""
    return (
        "<workspace_task_context>\nCurrent task state for this turn; supersedes older "
        "task snapshots in the conversation.\n"
        + brief
        + "\n</workspace_task_context>\n\n"
    )
