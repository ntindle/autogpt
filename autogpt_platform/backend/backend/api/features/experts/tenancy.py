from enum import Enum

from autogpt_libs.auth import RequestContext, get_request_context
from fastapi import HTTPException, Request, Security

from backend.api.features.orgs.db import get_user_default_team
from backend.data.db import prisma
from backend.data.db_accessors import experts_db
from backend.data.tenancy import has_live_resource_access
from backend.util.exceptions import ExpertPrivateTenancyNotFoundError


class ExpertLookupScope(Enum):
    SAVED = "saved"


async def resolve_expert_creation_scope(
    user_id: str, organization_id: str | None = None
) -> tuple[str, str | None]:
    if organization_id is None:
        organization_id, team_id = await get_user_default_team(user_id)
    else:
        team = await prisma.team.find_first(
            where={"orgId": organization_id, "isDefault": True, "archivedAt": None}
        )
        team_id = team.id if team else None
    if (
        organization_id is None
        or team_id is None
        or not await has_live_resource_access(
            user_id, organization_id, team_id, "create"
        )
    ):
        raise ExpertPrivateTenancyNotFoundError(organization_id or user_id)
    return organization_id, team_id


async def require_expert_request_scope(
    request: Request,
    ctx: RequestContext = Security(get_request_context),
) -> None:
    expert_id = request.path_params.get("expert_id")
    if expert_id is None:
        return
    expert = await experts_db().get_expert(
        ctx.user_id, expert_id, include_workflows=False
    )
    if expert is None or expert.organization_id != ctx.org_id:
        raise HTTPException(404, "Expert not found")
