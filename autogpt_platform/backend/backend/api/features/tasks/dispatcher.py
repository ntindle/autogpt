import logging

from backend.api.features.tasks.recovery import reconcile_task_dispatches
from backend.api.features.tasks.service import dispatch_task
from backend.data.db_accessors import tasks_db

logger = logging.getLogger(__name__)


async def dispatch_pending_workspace_tasks() -> None:
    await reconcile_task_dispatches()
    for task in await tasks_db().pending_workspace_task_dispatches():
        try:
            await dispatch_task(task)
        except Exception:
            logger.exception("Pending task dispatch failed for %s", task.id)
