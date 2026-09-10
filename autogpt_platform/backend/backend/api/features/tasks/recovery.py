import logging
from datetime import UTC, datetime, timedelta

from backend.copilot import stream_registry
from backend.data.db_accessors import tasks_db

logger = logging.getLogger(__name__)


async def reconcile_task_dispatches() -> None:
    for task in await tasks_db().unfinished_workspace_task_dispatches():
        if not task.session_id or not task.dispatch_id:
            continue
        claimed_at = task.dispatch_claimed_at or task.updated_at
        if claimed_at > datetime.now(UTC) - timedelta(minutes=2):
            continue
        try:
            session = await stream_registry.get_session(task.session_id)
            if session and session.status == "running":
                if task.dispatch_state == "claimed":
                    await tasks_db().update_workspace_task_dispatch(
                        task.user_id, task.id, task.dispatch_id, "sent"
                    )
                continue
            if session:
                await tasks_db().workspace_task_run_event(
                    task.user_id,
                    task.session_id,
                    "finished",
                    (
                        ""
                        if session.status == "completed"
                        else "Attempt failed. Open chat for details, then retry."
                    ),
                    turn_id=task.last_turn_id,
                )
            else:
                await tasks_db().workspace_task_run_event(
                    task.user_id,
                    task.session_id,
                    "finished",
                    "The attempt was interrupted. Check the conversation for completed actions before retrying.",
                    turn_id=task.last_turn_id,
                )
        except Exception:
            logger.exception("Could not reconcile task %s", task.id)
