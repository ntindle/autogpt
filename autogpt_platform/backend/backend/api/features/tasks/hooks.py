import logging

from backend.data.db_accessors import tasks_db

logger = logging.getLogger(__name__)


async def notify_task_lifecycle(
    user_id: str | None,
    session_id: str,
    event: str,
    text: str = "",
    turn_id: str | None = None,
) -> None:
    if not user_id:
        return
    try:
        await tasks_db().workspace_task_run_event(
            user_id, session_id, event, text, turn_id=turn_id
        )
    except Exception:
        logger.exception("Could not update task for session %s", session_id)
