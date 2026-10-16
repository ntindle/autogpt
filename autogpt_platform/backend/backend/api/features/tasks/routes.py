from typing import Annotated

import autogpt_libs.auth as auth
from fastapi import APIRouter, BackgroundTasks, HTTPException, Security

from backend.api.features.tasks.context import task_context
from backend.api.features.tasks.decomposition import (
    accept_task_breakdown,
    generate_task_breakdown,
)
from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.models import (
    TaskBreakdownAccept,
    TaskBreakdownRequest,
    TaskCommand,
    TaskContextResponse,
    TaskCreate,
    TaskListResponse,
    TaskSessionScope,
    WorkspaceTask,
)
from backend.api.features.tasks.planning_refresh import (
    reconsider_unassigned_workspace_tasks,
)
from backend.api.features.tasks.recommendations import (
    generate_task_suggestion,
    suggest_task_assignee,
)
from backend.api.features.tasks.schedules import (
    TaskScheduleInfo,
    TaskScheduleRequest,
    list_task_schedules,
    schedule_task,
    set_schedule_paused,
)
from backend.api.features.tasks.service import execute_task_command, task_assignees
from backend.copilot.model import get_chat_session_metadata
from backend.data.db_accessors import tasks_db
from backend.data.tenancy import has_live_resource_access
from backend.util.exceptions import NotFoundError

router = APIRouter(
    prefix="/tasks",
    tags=["tasks", "private"],
    dependencies=[Security(auth.requires_user)],
)
UserID = Annotated[str, Security(auth.get_user_id)]
Context = Annotated[auth.RequestContext, Security(auth.get_request_context)]


@router.get("", operation_id="list_workspace_tasks")
async def list_tasks(
    user_id: UserID, background_tasks: BackgroundTasks, ctx: Context
) -> TaskListResponse:
    tasks = await tasks_db().list_workspace_tasks(user_id, organization_id=ctx.org_id)
    background_tasks.add_task(
        reconsider_unassigned_workspace_tasks, user_id, ctx.org_id
    )
    return TaskListResponse(
        tasks=tasks,
        assignees=await task_assignees(user_id, organization_id=ctx.org_id),
    )


@router.post("", operation_id="create_workspace_task", status_code=201)
async def create_task(
    request: TaskCreate,
    user_id: UserID,
    ctx: Context,
    background_tasks: BackgroundTasks,
) -> WorkspaceTask:
    try:
        task = await tasks_db().create_workspace_task(
            user_id, request, ctx.org_id, team_id=ctx.team_id
        )
        background_tasks.add_task(
            suggest_task_assignee,
            user_id,
            task.id,
            organization_id=task.organization_id,
        )
        return task
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (TaskConflict, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get(
    "/conversation/{session_id}/scope", operation_id="get_workspace_task_session_scope"
)
async def get_task_session_scope(session_id: str, user_id: UserID) -> TaskSessionScope:
    session = await get_chat_session_metadata(session_id, user_id)
    if session is None or not await has_live_resource_access(
        user_id, session.organization_id, session.team_id, "view"
    ):
        raise HTTPException(404, "Conversation not found")
    return TaskSessionScope(
        organization_id=session.organization_id, team_id=session.team_id
    )


@router.post("/{task_id}/commands", operation_id="command_workspace_task")
async def command_task(
    task_id: str, request: TaskCommand, user_id: UserID, ctx: Context
) -> WorkspaceTask:
    try:
        return await execute_task_command(
            user_id, task_id, request, organization_id=ctx.org_id
        )
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (TaskConflict, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/schedules", operation_id="list_task_schedules")
async def get_schedules(user_id: UserID, ctx: Context) -> list[TaskScheduleInfo]:
    return await list_task_schedules(user_id, organization_id=ctx.org_id)


@router.post("/{task_id}/schedule", operation_id="schedule_workspace_task")
async def create_task_schedule(
    task_id: str, request: TaskScheduleRequest, user_id: UserID, ctx: Context
) -> WorkspaceTask:
    try:
        return await schedule_task(
            user_id, task_id, request, organization_id=ctx.org_id
        )
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/schedules/{schedule_id}/pause", operation_id="pause_task_schedule")
async def pause_task_schedule(
    schedule_id: str, user_id: UserID, ctx: Context
) -> dict[str, bool]:
    await set_schedule_paused(user_id, schedule_id, True, organization_id=ctx.org_id)
    return {"paused": True}


@router.post("/schedules/{schedule_id}/resume", operation_id="resume_task_schedule")
async def resume_task_schedule(
    schedule_id: str, user_id: UserID, ctx: Context
) -> dict[str, bool]:
    await set_schedule_paused(user_id, schedule_id, False, organization_id=ctx.org_id)
    return {"paused": False}


@router.post("/{task_id}/suggest", operation_id="suggest_workspace_task_owner")
async def suggest_owner(
    task_id: str, user_id: UserID, background_tasks: BackgroundTasks, ctx: Context
) -> WorkspaceTask:
    try:
        task = await tasks_db().begin_workspace_task_suggestion(
            user_id, task_id, True, organization_id=ctx.org_id
        )
        if task:
            background_tasks.add_task(generate_task_suggestion, user_id, task)
            return task
        return next(
            t
            for t in await tasks_db().list_workspace_tasks(
                user_id, organization_id=ctx.org_id
            )
            if t.id == task_id
        )
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/{task_id}/breakdown", operation_id="preview_workspace_task_breakdown")
async def preview_breakdown(
    task_id: str,
    request: TaskBreakdownRequest,
    user_id: UserID,
    background_tasks: BackgroundTasks,
    ctx: Context,
) -> WorkspaceTask:
    try:
        task = await tasks_db().begin_workspace_task_breakdown(
            user_id, task_id, request, organization_id=ctx.org_id
        )
        background_tasks.add_task(generate_task_breakdown, user_id, task)
        return task
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (TaskConflict, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post(
    "/{task_id}/breakdown/accept", operation_id="accept_workspace_task_breakdown"
)
async def accept_breakdown(
    task_id: str, request: TaskBreakdownAccept, user_id: UserID, ctx: Context
) -> WorkspaceTask:
    try:
        return await accept_task_breakdown(
            user_id, task_id, request, organization_id=ctx.org_id
        )
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (TaskConflict, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/conversation/{session_id}", operation_id="get_workspace_task_context")
async def conversation_context(
    session_id: str, user_id: UserID, ctx: Context
) -> TaskContextResponse:
    tasks = await tasks_db().list_workspace_tasks(user_id, organization_id=ctx.org_id)
    task = next((t for t in tasks if t.session_id == session_id), None)
    if not task:
        raise HTTPException(404, "No task is linked to this conversation")
    return task_context(task, tasks)
