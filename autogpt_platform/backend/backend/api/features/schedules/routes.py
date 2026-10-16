from typing import Annotated, Any

from autogpt_libs.auth import get_user_id, requires_user
from autogpt_libs.auth.models import RequestContext
from autogpt_libs.auth.permissions import OrgAction, TeamAction
from fastapi import APIRouter, Body, HTTPException, Path, Security
from prisma.enums import GrantCapability
from starlette.status import HTTP_404_NOT_FOUND

from backend.api.features.experts import experts_db
from backend.api.features.library import db as library_db
from backend.api.features.schedule_visibility import visible_graph_schedules
from backend.api.features.schedules.model import (
    ScheduleCreationRequest,
    ScheduleUpdateRequest,
)
from backend.api.live_auth import (
    requires_live_resource_permission as requires_resource_permission,
)
from backend.api.live_auth import resolve_write_team_id as _resolve_write_team_id
from backend.data import graph as graph_db
from backend.data.grants import resolve_graph_grant
from backend.data.onboarding import OnboardingStep, complete_onboarding_step
from backend.data.tenancy import (
    get_user_team_ids,
    live_resource_access_barrier,
    live_resource_permission_barrier,
)
from backend.data.user import get_user_by_id
from backend.executor import scheduler
from backend.util.clients import get_scheduler_client
from backend.util.exceptions import NotAuthorizedError, NotFoundError
from backend.util.timezone_utils import (
    convert_utc_time_to_user_timezone,
    get_user_timezone_or_utc,
)

# This router mounts at /api and keeps the section's full paths: its six routes
# span two prefixes (/schedules and /graphs/{graph_id}/schedules), so a prefixed
# mount would have to move one of them.
router = APIRouter(dependencies=[Security(requires_user)])


async def _schedule_team_ids(user_id: str, ctx: RequestContext) -> list[str]:
    if ctx.team_id is not None:
        return [ctx.team_id]
    return await get_user_team_ids(user_id, ctx.org_id) if ctx.org_id else []


@router.post(
    path="/graphs/{graph_id}/schedules",
    summary="Create execution schedule",
)
async def create_graph_execution_schedule(
    user_id: Annotated[str, Security(get_user_id)],
    ctx: Annotated[
        RequestContext,
        requires_resource_permission(
            OrgAction.CREATE_RESOURCES, TeamAction.CREATE_AGENTS
        ),
    ],
    graph_id: str = Path(..., description="ID of the graph to schedule"),
    schedule_params: ScheduleCreationRequest = Body(),
) -> scheduler.GraphExecutionJobInfo:
    if (
        ctx.team_id is not None
        and schedule_params.team_id is not None
        and schedule_params.team_id != ctx.team_id
    ):
        raise HTTPException(
            status_code=400,
            detail="The requested team must match the active workspace context.",
        )
    graph = await graph_db.get_graph(
        graph_id=graph_id,
        version=schedule_params.graph_version,
        user_id=user_id,
        organization_id=ctx.org_id,
        team_id=ctx.team_id,
    )
    if not graph:
        raise HTTPException(
            status_code=404,
            detail=f"Graph #{graph_id} v{schedule_params.graph_version} not found.",
        )

    # A schedule is bound to a graph, so it inherits the graph's tenant unless
    # the picker explicitly targets a team the caller may write into, or the
    # request carries an active team. As in update_graph, the graph's team is
    # only inherited when the graph lives in the org this request acts in.
    if schedule_params.team_id is not None:
        resolved_team_id = await _resolve_write_team_id(
            user_id, ctx.org_id, schedule_params.team_id
        )
    elif ctx.team_id is not None:
        resolved_team_id = ctx.team_id
    else:
        resolved_team_id = (
            graph.team_id if graph.organization_id == ctx.org_id else None
        )

    # Use timezone from request if provided, otherwise fetch from user profile
    if schedule_params.timezone:
        user_timezone = schedule_params.timezone
    else:
        user = await get_user_by_id(user_id)
        user_timezone = get_user_timezone_or_utc(user.timezone if user else None)

    # Expert attribution: explicit expert_id must be an active expert owned
    # by the caller; when omitted, a unique (user, graph) → expert match
    # keeps attribution for schedules created through the generic UI.
    expert_id = schedule_params.expert_id
    if expert_id is not None:
        expert = await experts_db.get_expert(
            user_id, expert_id, include_workflows=False
        )
        if expert is None or expert.is_archived:
            raise HTTPException(
                status_code=404, detail=f"Expert #{expert_id} not found."
            )
        if (expert.organization_id, expert.team_id) != (
            ctx.org_id,
            resolved_team_id,
        ):
            raise HTTPException(
                status_code=404, detail=f"Expert #{expert_id} not found."
            )
    else:
        expert_id = await experts_db.resolve_expert_for_graph(
            user_id,
            graph_id,
            organization_id=ctx.org_id,
            team_id=resolved_team_id,
            enforce_scope=True,
        )

    library_agent = await library_db.get_library_agent_by_graph_id(
        user_id=user_id,
        graph_id=graph_id,
        graph_version=graph.version,
        organization_id=ctx.org_id,
        team_id_restriction=resolved_team_id,
        exact_scope=True,
    )
    authorized_scope = library_agent is not None
    if library_agent is None and resolved_team_id is not None:
        grant = await resolve_graph_grant(
            user_id,
            graph_id,
            capability=GrantCapability.EXECUTE,
            graph_version=graph.version,
            organization_id=ctx.org_id,
            team_id_restriction=resolved_team_id,
        )
        authorized_scope = grant is not None
    if not authorized_scope:
        raise HTTPException(
            status_code=404,
            detail=f"Graph #{graph_id} is not available in this workspace",
        )

    async with live_resource_permission_barrier(
        user_id,
        ctx.org_id,
        resolved_team_id,
        OrgAction.CREATE_RESOURCES,
        TeamAction.CREATE_AGENTS,
    ) as allowed:
        if not allowed:
            raise HTTPException(status_code=403, detail="Resource scope is inactive")
        result = await get_scheduler_client().add_execution_schedule(
            user_id=user_id,
            graph_id=graph_id,
            graph_version=graph.version,
            name=schedule_params.name,
            cron=schedule_params.cron,
            input_data=schedule_params.inputs,
            input_credentials=schedule_params.credentials,
            user_timezone=user_timezone,
            organization_id=ctx.org_id,
            team_id=resolved_team_id,
            expert_id=expert_id,
        )

    # Convert the next_run_time back to user timezone for display
    if result.next_run_time:
        result.next_run_time = convert_utc_time_to_user_timezone(
            result.next_run_time, user_timezone
        )

    await complete_onboarding_step(user_id, OnboardingStep.SCHEDULE_AGENT)

    return result


@router.get(
    path="/graphs/{graph_id}/schedules",
    summary="List execution schedules for a graph",
)
async def list_graph_execution_schedules(
    user_id: Annotated[str, Security(get_user_id)],
    ctx: Annotated[
        RequestContext,
        requires_resource_permission(OrgAction.VIEW_RESOURCES, TeamAction.VIEW_AGENTS),
    ],
    graph_id: str = Path(),
) -> list[scheduler.GraphExecutionJobInfo]:
    team_ids = await _schedule_team_ids(user_id, ctx)
    schedules = await get_scheduler_client().get_graph_execution_schedules(
        user_id=user_id,
        graph_id=graph_id,
        organization_id=ctx.org_id,
        team_ids=team_ids,
        include_paused=True,
    )
    return await visible_graph_schedules(schedules, user_id)


@router.get(
    path="/schedules",
    summary="List execution schedules for a user",
)
async def list_all_graphs_execution_schedules(
    user_id: Annotated[str, Security(get_user_id)],
    ctx: Annotated[
        RequestContext,
        requires_resource_permission(OrgAction.VIEW_RESOURCES, TeamAction.VIEW_AGENTS),
    ],
) -> list[scheduler.GraphExecutionJobInfo]:
    team_ids = await _schedule_team_ids(user_id, ctx)
    schedules = await get_scheduler_client().get_graph_execution_schedules(
        user_id=user_id,
        organization_id=ctx.org_id,
        team_ids=team_ids,
        include_paused=True,
    )
    return await visible_graph_schedules(schedules, user_id)


# Keep above /schedules/{schedule_id}: a GET added there would otherwise match
# "followups" as an id, since FastAPI answers with the first route that fits.
@router.get(
    path="/schedules/followups",
    summary="List copilot follow-up schedules for a user",
    operation_id="listCopilotFollowupSchedules",
)
async def list_copilot_turn_schedules(
    user_id: Annotated[str, Security(get_user_id)],
    ctx: Annotated[
        RequestContext,
        requires_resource_permission(OrgAction.VIEW_RESOURCES, TeamAction.VIEW_AGENTS),
    ],
) -> list[scheduler.CopilotTurnJobInfo]:
    """Return only copilot-turn schedules for the current user.

    Sibling of :func:`list_all_graphs_execution_schedules`; one route per kind
    keeps the generated frontend client typed to a single concrete return type
    instead of a discriminated union.
    """
    team_ids = await _schedule_team_ids(user_id, ctx)
    schedules = await get_scheduler_client().get_execution_schedules(
        user_id=user_id,
        kind="copilot_turn",
        organization_id=ctx.org_id,
        team_ids=team_ids,
    )
    # Defensive isinstance filter mirrors ``get_graph_execution_schedules``
    # (executor.scheduler.Scheduler) — the scheduler is the source of truth
    # for the ``kind`` filter, but we narrow the polymorphic
    # ``list[GraphExecutionJobInfo | CopilotTurnJobInfo]`` to the typed
    # subset before returning so the generated frontend client gets a single
    # concrete schema. If a row ever slips through the discriminator (e.g.
    # legacy untyped row, scheduler-side bug), we drop it rather than fail
    # the response with a Pydantic validation error.
    return [
        s
        for s in schedules
        if isinstance(s, scheduler.CopilotTurnJobInfo) and s.user_id == user_id
    ]


@router.delete(
    path="/schedules/{schedule_id}",
    summary="Delete execution schedule",
)
async def delete_graph_execution_schedule(
    user_id: Annotated[str, Security(get_user_id)],
    ctx: Annotated[
        RequestContext,
        requires_resource_permission(
            OrgAction.CREATE_RESOURCES, TeamAction.CREATE_AGENTS
        ),
    ],
    schedule_id: str = Path(..., description="ID of the schedule to delete"),
) -> dict[str, Any]:
    try:
        scheduler_client = get_scheduler_client()
        candidate = await scheduler_client.get_execution_schedule(
            schedule_id,
            user_id=user_id,
            organization_id=ctx.org_id,
            team_ids=await _schedule_team_ids(user_id, ctx),
        )
        target_team_ids = [candidate.team_id] if candidate.team_id is not None else []
        async with live_resource_access_barrier(
            user_id, ctx.org_id, candidate.team_id, "create"
        ) as allowed:
            if not allowed:
                raise HTTPException(403, detail="Resource scope is inactive")
            await scheduler_client.get_execution_schedule(
                schedule_id,
                user_id=user_id,
                organization_id=ctx.org_id,
                team_ids=target_team_ids,
            )
            await scheduler_client.delete_schedule(
                schedule_id,
                user_id=user_id,
                organization_id=ctx.org_id,
                team_ids=target_team_ids,
            )
    except NotFoundError:
        raise HTTPException(
            status_code=HTTP_404_NOT_FOUND,
            detail=f"Schedule #{schedule_id} not found",
        )
    return {"id": schedule_id}


@router.patch(
    path="/schedules/{schedule_id}",
    summary="Update execution schedule",
)
async def update_graph_execution_schedule(
    user_id: Annotated[str, Security(get_user_id)],
    ctx: Annotated[
        RequestContext,
        requires_resource_permission(
            OrgAction.CREATE_RESOURCES, TeamAction.CREATE_AGENTS
        ),
    ],
    schedule_id: str = Path(..., description="ID of the schedule to update"),
    update: ScheduleUpdateRequest = Body(),
) -> scheduler.GraphExecutionJobInfo:
    """Change an agent schedule's name, timing or inputs. Only the schedule's
    owner can edit it; anyone else gets the same 404 as a missing schedule."""
    try:
        scheduler_client = get_scheduler_client()
        candidate = await scheduler_client.get_execution_schedule(
            schedule_id,
            user_id=user_id,
            organization_id=ctx.org_id,
            team_ids=await _schedule_team_ids(user_id, ctx),
        )
        async with live_resource_access_barrier(
            user_id, ctx.org_id, candidate.team_id, "create"
        ) as allowed:
            if not allowed:
                raise HTTPException(403, detail="Resource scope is inactive")
            result = await scheduler_client.update_execution_schedule(
                schedule_id=schedule_id,
                user_id=user_id,
                name=update.name,
                cron=update.cron,
                user_timezone=update.timezone,
                input_data=update.inputs,
                input_credentials=update.credentials,
                organization_id=ctx.org_id,
                team_ids=[candidate.team_id] if candidate.team_id is not None else [],
            )
    except (NotFoundError, NotAuthorizedError):
        raise HTTPException(
            status_code=HTTP_404_NOT_FOUND,
            detail=f"Schedule #{schedule_id} not found",
        )

    if result.next_run_time:
        result.next_run_time = convert_utc_time_to_user_timezone(
            result.next_run_time, result.timezone
        )
    return result
