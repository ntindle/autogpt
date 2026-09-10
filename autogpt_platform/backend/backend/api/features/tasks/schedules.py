from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from backend.api.features.tasks.models import TaskSchedule, WorkspaceTask
from backend.api.features.tasks.service import dispatch_user_tasks
from backend.data.db_accessors import tasks_db
from backend.executor.scheduler import (
    CopilotTurnJobArgs,
    CopilotTurnJobInfo,
    _build_trigger,
)
from backend.util.clients import get_scheduler_client
from backend.util.exceptions import NotFoundError


class TaskScheduleRequest(BaseModel):
    version: int
    cron: str | None = None
    run_at: datetime | None = None
    timezone: str = Field(default="UTC", max_length=100)

    @model_validator(mode="after")
    def one_trigger(self):
        if bool(self.cron) == bool(self.run_at):
            raise ValueError("Choose a one-time date or a recurring cadence")
        if self.run_at and (
            self.run_at.tzinfo is None or self.run_at <= datetime.now(UTC)
        ):
            raise ValueError("Choose a future date with a timezone")
        return self


class TaskScheduleInfo(BaseModel):
    id: str
    name: str
    kind: Literal["graph", "copilot_turn"]
    cron: str | None = None
    run_at: datetime | None = None
    timezone: str
    next_run_time: str
    paused: bool = False
    session_id: str | None = None
    expert_id: str | None = None
    task_id: str | None = None


async def list_task_schedules(user_id: str) -> list[TaskScheduleInfo]:
    jobs = await get_scheduler_client().get_execution_schedules(
        user_id=user_id, include_paused=True
    )
    return [
        TaskScheduleInfo(
            id=job.id,
            name=job.name,
            kind=job.kind,
            timezone=job.timezone,
            cron=job.cron,
            next_run_time=job.next_run_time,
            paused=not bool(job.next_run_time),
            expert_id=job.expert_id,
            session_id=job.session_id if isinstance(job, CopilotTurnJobInfo) else None,
            run_at=job.run_at if isinstance(job, CopilotTurnJobInfo) else None,
            task_id=(
                job.workspace_task_id if isinstance(job, CopilotTurnJobInfo) else None
            ),
        )
        for job in jobs
    ]


async def schedule_task(
    user_id: str, task_id: str, request: TaskScheduleRequest
) -> WorkspaceTask:
    _build_trigger(
        cron=request.cron, run_at=request.run_at, user_timezone=request.timezone
    )
    task = await tasks_db().configure_workspace_task_schedule(
        user_id,
        task_id,
        request.version,
        TaskSchedule(
            cron=request.cron, run_at=request.run_at, timezone=request.timezone
        ),
    )
    assert task.schedule
    await get_scheduler_client().add_copilot_turn_schedule(
        user_id=user_id,
        message=task.title,
        name=task.title,
        cron=request.cron,
        run_at=request.run_at,
        user_timezone=request.timezone,
        organization_id=task.organization_id,
        expert_id=(
            task.assignee.id
            if task.assignee and task.assignee.kind == "expert"
            else None
        ),
        workspace_task_id=task.id,
        schedule_id=task.schedule.id,
    )
    return task


async def set_schedule_paused(user_id: str, schedule_id: str, paused: bool) -> None:
    jobs = await list_task_schedules(user_id)
    job = next((job for job in jobs if job.id == schedule_id), None)
    if job is None:
        raise NotFoundError("Schedule not found")
    scheduler = get_scheduler_client()
    if paused:
        await scheduler.pause_schedule(schedule_id, user_id=user_id)
    else:
        await scheduler.resume_schedule(schedule_id, user_id=user_id)
    if job.task_id:
        task = next(
            t
            for t in await tasks_db().list_workspace_tasks(user_id)
            if t.id == job.task_id
        )
        if task.schedule:
            task.schedule.paused = paused
            await tasks_db().configure_workspace_task_schedule(
                user_id, task.id, task.version, task.schedule
            )


async def run_task_occurrence(args: CopilotTurnJobArgs) -> None:
    if not args.workspace_task_id or not args.schedule_id:
        return
    scheduled_for = args.run_at or datetime.now(UTC).replace(second=0, microsecond=0)
    await tasks_db().create_workspace_task_occurrence(
        args.user_id,
        args.workspace_task_id,
        args.schedule_id,
        scheduled_for.isoformat(),
    )
    await dispatch_user_tasks(args.user_id)
