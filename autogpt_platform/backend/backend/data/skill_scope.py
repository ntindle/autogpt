from prisma.enums import ResourceVisibility
from pydantic import BaseModel

from backend.api.features.orgs.db import get_user_default_team
from backend.data.db import prisma
from backend.data.tenancy import has_live_resource_access
from backend.util.exceptions import ExpertPrivateTenancyNotFoundError


class SkillRegistryScope(BaseModel):
    organization_id: str
    team_id: str | None


async def resolve_skill_registry_scope(
    user_id: str,
    expert_id: str | None = None,
    organization_id: str | None = None,
) -> SkillRegistryScope:
    if expert_id is not None:
        expert = await prisma.expert.find_first(
            where={
                "id": expert_id,
                "ownerUserId": user_id,
                "isTemplate": False,
                "isArchived": False,
                "visibility": ResourceVisibility.PRIVATE,
            }
        )
        if (
            expert is None
            or expert.organizationId is None
            or (
                organization_id is not None and organization_id != expert.organizationId
            )
        ):
            raise ExpertPrivateTenancyNotFoundError(expert_id)
        organization_id, team_id = expert.organizationId, expert.teamId
    elif organization_id is None:
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
            user_id, organization_id, team_id, "execute"
        )
    ):
        raise ExpertPrivateTenancyNotFoundError(expert_id or user_id)
    return SkillRegistryScope(organization_id=organization_id, team_id=team_id)
