import asyncio
import logging

from backend.api.features.tasks.decomposition import generate_task_breakdown
from backend.api.features.tasks.recommendations import generate_task_suggestion
from backend.data.db_accessors import tasks_db

logger = logging.getLogger(__name__)


async def reconsider_unassigned_workspace_tasks(user_id: str | None = None) -> None:
    users = [user_id] if user_id else await tasks_db().workspace_task_planning_users()
    semaphore = asyncio.Semaphore(3)

    async def refresh_user(owner: str) -> None:
        async with semaphore:
            try:
                jobs = await tasks_db().reconsider_workspace_task_plans(owner)
                operations = []
                for job in jobs:
                    if job.owner:
                        operations.append(generate_task_suggestion(owner, job.task))
                    if job.breakdown:
                        operations.append(generate_task_breakdown(owner, job.task))
                await asyncio.gather(*operations)
            except Exception:
                logger.exception(
                    "Could not reconsider unassigned task plans for user %s", owner
                )

    await asyncio.gather(*(refresh_user(owner) for owner in users))
