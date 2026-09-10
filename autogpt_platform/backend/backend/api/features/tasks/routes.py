from typing import Annotated

import autogpt_libs.auth as auth
from fastapi import APIRouter, BackgroundTasks, HTTPException, Security

from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.models import (
    TaskCommand,
    TaskCreate,
    TaskListResponse,
    WorkspaceTask,
)
from backend.api.features.tasks.recommendations import suggest_task_assignee
from backend.api.features.tasks.schedules import (
    TaskScheduleInfo,
    TaskScheduleRequest,
    list_task_schedules,
    schedule_task,
    set_schedule_paused,
)
from backend.api.features.tasks.service import execute_task_command, task_assignees
from backend.data.db_accessors import tasks_db
from backend.util.exceptions import NotFoundError

router = APIRouter(
    prefix="/tasks",
    tags=["tasks", "private"],
    dependencies=[Security(auth.requires_user)],
)
UserID = Annotated[str, Security(auth.get_user_id)]
Context = Annotated[auth.RequestContext, Security(auth.get_request_context)]


@router.get("", operation_id="list_workspace_tasks")
async def list_tasks(user_id: UserID) -> TaskListResponse:
    return TaskListResponse(
        tasks=await tasks_db().list_workspace_tasks(user_id),
        assignees=await task_assignees(user_id),
    )


@router.post("", operation_id="create_workspace_task", status_code=201)
async def create_task(
    request: TaskCreate,
    user_id: UserID,
    ctx: Context,
    background_tasks: BackgroundTasks,
) -> WorkspaceTask:
    try:
        task = await tasks_db().create_workspace_task(user_id, request, ctx.org_id)
        background_tasks.add_task(suggest_task_assignee, user_id, task.id)
        return task
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (TaskConflict, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{task_id}/commands", operation_id="command_workspace_task")
async def command_task(
    task_id: str, request: TaskCommand, user_id: UserID
) -> WorkspaceTask:
    try:
        return await execute_task_command(user_id, task_id, request)
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (TaskConflict, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/schedules", operation_id="list_task_schedules")
async def get_schedules(user_id: UserID) -> list[TaskScheduleInfo]:
    return await list_task_schedules(user_id)


@router.post("/{task_id}/schedule", operation_id="schedule_workspace_task")
async def create_task_schedule(
    task_id: str, request: TaskScheduleRequest, user_id: UserID
) -> WorkspaceTask:
    try:
        return await schedule_task(user_id, task_id, request)
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/schedules/{schedule_id}/pause", operation_id="pause_task_schedule")
async def pause_task_schedule(schedule_id: str, user_id: UserID) -> dict[str, bool]:
    await set_schedule_paused(user_id, schedule_id, True)
    return {"paused": True}


@router.post("/schedules/{schedule_id}/resume", operation_id="resume_task_schedule")
async def resume_task_schedule(schedule_id: str, user_id: UserID) -> dict[str, bool]:
    await set_schedule_paused(user_id, schedule_id, False)
    return {"paused": False}
