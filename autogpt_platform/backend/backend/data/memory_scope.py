"""Durable owner-private memory namespaces and the original personal org."""

from pydantic import BaseModel

from backend.api.features.orgs.db import get_user_default_team
from backend.copilot.graphiti.scope import MemoryScope
from backend.data.db import query_raw_with_schema


class PersonalMemoryOrganization(BaseModel):
    organization_id: str


async def get_personal_memory_organization(user_id: str) -> str:
    rows = await query_raw_with_schema(
        'SELECT "organizationId" AS organization_id FROM {schema_prefix}"PersonalMemoryOrganization" WHERE "userId" = $1',
        user_id,
        model=PersonalMemoryOrganization,
    )
    if rows:
        return rows[0].organization_id
    organization_id, _ = await get_user_default_team(user_id)
    if organization_id is None:
        raise ValueError("Personal memory organization could not be resolved")
    rows = await query_raw_with_schema(
        """INSERT INTO {schema_prefix}"PersonalMemoryOrganization" ("userId", "organizationId")
           VALUES ($1, $2) ON CONFLICT ("userId") DO UPDATE SET "userId" = EXCLUDED."userId"
           RETURNING "organizationId" AS organization_id""",
        user_id,
        organization_id,
        model=PersonalMemoryOrganization,
    )
    return rows[0].organization_id


async def register_memory_scope(scope: MemoryScope) -> None:
    await query_raw_with_schema(
        '''INSERT INTO {schema_prefix}"MemoryScopeRegistry"
           ("scopeKey", "userId", "organizationId", "expertId", "groupId")
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ("scopeKey") DO NOTHING RETURNING "scopeKey"''',
        scope.scope_key,
        scope.owner_user_id,
        scope.organization_id,
        scope.expert_id,
        scope.group_id,
    )


async def list_memory_scopes(user_id: str) -> list[MemoryScope]:
    return await query_raw_with_schema(
        '''SELECT "userId" AS owner_user_id, "organizationId" AS organization_id,
                  "expertId" AS expert_id, "groupId" AS group_id, "scopeKey" AS scope_key
           FROM {schema_prefix}"MemoryScopeRegistry" WHERE "userId" = $1
           ORDER BY "scopeKey"''',
        user_id,
        model=MemoryScope,
    )
