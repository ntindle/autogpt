from datetime import UTC, datetime, timedelta

from pydantic import BaseModel

from backend.api.features.tasks.domain import ancestors
from backend.api.features.tasks.models import TaskBreakdown, WorkspaceTask
from backend.api.features.tasks.planning_db import start_suggestion
from backend.api.features.tasks.planning_inputs import (
    load_planning_environment,
    task_planning_inputs,
)
from backend.api.features.tasks.repository import _load, _lock, _save
from backend.data.db import prisma, query_raw_with_schema


class TaskPlanningJob(BaseModel):
    task: WorkspaceTask
    owner: bool = False
    breakdown: bool = False


class PlanningUser(BaseModel):
    user_id: str


async def workspace_task_planning_users() -> list[str]:
    rows = await query_raw_with_schema(
        """
        SELECT DISTINCT "userId" AS user_id FROM {schema_prefix}"WorkspaceTask"
        WHERE (payload->>'assignee') IS NULL
          AND COALESCE(payload->>'status', 'todo') NOT IN ('done', 'canceled')
          AND (payload->>'review_of') IS NULL AND (payload->>'schedule') IS NULL
        ORDER BY "userId"
    """,
        model=PlanningUser,
    )
    return [row.user_id for row in rows]


async def reconsider_workspace_task_plans(
    user_id: str, limit: int = 10
) -> list[TaskPlanningJob]:
    async with prisma.tx(timeout=timedelta(seconds=30)) as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        eligible = [
            task
            for task in tasks
            if not task.assignee
            and not task.review_of
            and not task.schedule
            and task.status not in ("done", "canceled")
        ]
        if not eligible:
            return []
        stale = datetime.now(UTC) - timedelta(minutes=2)
        available = 4 - sum(
            int(
                task.suggestion_state == "pending"
                and bool(
                    task.suggestion_started_at and task.suggestion_started_at >= stale
                )
            )
            + int(
                bool(
                    task.breakdown
                    and task.breakdown.state == "pending"
                    and task.breakdown.started_at >= stale
                )
            )
            + int(
                bool(
                    task.breakdown_refresh
                    and task.breakdown_refresh.state == "pending"
                    and task.breakdown_refresh.started_at >= stale
                )
            )
            for task in eligible
        )
        if available <= 0:
            return []
        scope = list(
            {
                item.id: item for task in eligible for item in ancestors(task, tasks)
            }.values()
        )
        environment = await load_planning_environment(tx, user_id, scope)
        jobs = []
        for task in eligible:
            inputs = task_planning_inputs(task, tasks, environment)
            if inputs.busy:
                continue
            if (
                task.breakdown_refresh
                and task.breakdown
                and task.breakdown.context == inputs.fingerprint
            ):
                task.breakdown_refresh = None
                await _save(tx, task)
            owner = available > 0 and owner_due(task, inputs.fingerprint, stale)
            available -= int(owner)
            breakdown = available > 0 and breakdown_due(task, inputs.fingerprint, stale)
            available -= int(breakdown)
            if not owner and not breakdown:
                continue
            if owner:
                start_suggestion(task, inputs.fingerprint)
            if breakdown and task.breakdown:
                task.breakdown_refresh = TaskBreakdown(
                    context=inputs.fingerprint,
                    detail=task.breakdown.detail,
                    guidance=task.breakdown.guidance,
                )
            await _save(tx, task)
            jobs.append(TaskPlanningJob(task=task, owner=owner, breakdown=breakdown))
            if len(jobs) >= limit or available <= 0:
                break
        return jobs


def owner_due(task: WorkspaceTask, fingerprint: str, stale: datetime) -> bool:
    if task.suggestion_state == "pending":
        return not task.suggestion_started_at or task.suggestion_started_at < stale
    return task.suggestion_state == "idle" or task.suggestion_context != fingerprint


def breakdown_due(task: WorkspaceTask, fingerprint: str, stale: datetime) -> bool:
    preview = task.breakdown
    if not preview or preview.state == "accepted":
        return False
    refresh = task.breakdown_refresh
    if refresh:
        if refresh.state == "pending" and refresh.started_at >= stale:
            return False
        if refresh.state == "error" and refresh.context == fingerprint:
            return False
    if preview.state == "pending":
        return preview.started_at < stale
    return preview.context != fingerprint
