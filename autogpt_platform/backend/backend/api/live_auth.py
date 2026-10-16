from collections.abc import AsyncIterator, Callable
from typing import TypeVar, cast

import autogpt_libs.auth as autogpt_auth_lib
from fastapi import Depends, HTTPException, Security
from fastapi.params import Depends as DependsParameter

from backend.api.org_rollout import require_personal_scope_without_collaboration
from backend.data.tenancy import (
    get_user_team_ids,
    live_actor_org_permission_barrier,
    live_org_permission_barrier,
    live_resource_permission_barrier,
)

_T = TypeVar("_T")


def live_dependency(
    dependency: Callable[..., AsyncIterator[_T]],
) -> DependsParameter:
    return Depends(dependency, scope="function")


def requires_live_resource_permission(
    org_action: autogpt_auth_lib.OrgAction,
    team_action: autogpt_auth_lib.TeamAction,
) -> autogpt_auth_lib.RequestContext:
    async def dependency(
        user_id: str = Security(autogpt_auth_lib.get_user_id),
        ctx: autogpt_auth_lib.RequestContext = Security(
            autogpt_auth_lib.requires_resource_permission(org_action, team_action)
        ),
    ) -> AsyncIterator[autogpt_auth_lib.RequestContext]:
        async with live_resource_permission_barrier(
            user_id,
            ctx.org_id,
            ctx.team_id,
            org_action,
            team_action,
        ) as allowed:
            if not allowed:
                raise HTTPException(403, detail="Resource scope is inactive")
            yield ctx

    return cast(autogpt_auth_lib.RequestContext, live_dependency(dependency))


def requires_live_org_permission(
    action: autogpt_auth_lib.OrgAction,
) -> autogpt_auth_lib.RequestContext:
    async def dependency(
        ctx: autogpt_auth_lib.RequestContext = Security(
            autogpt_auth_lib.requires_org_permission(action)
        ),
    ) -> AsyncIterator[autogpt_auth_lib.RequestContext]:
        if ctx.org_id is None:
            raise HTTPException(403, detail="Organization access is inactive")
        async with live_org_permission_barrier(
            ctx.user_id, ctx.org_id, action
        ) as allowed:
            if not allowed:
                raise HTTPException(403, detail="Organization access is inactive")
            yield ctx

    return cast(autogpt_auth_lib.RequestContext, live_dependency(dependency))


def requires_live_actor_org_permission(
    action: autogpt_auth_lib.OrgAction,
) -> autogpt_auth_lib.RequestContext:
    async def dependency(
        ctx: autogpt_auth_lib.RequestContext = Security(
            autogpt_auth_lib.requires_org_permission(action)
        ),
    ) -> AsyncIterator[autogpt_auth_lib.RequestContext]:
        if ctx.org_id is None:
            raise HTTPException(403, detail="Organization access is inactive")
        async with live_actor_org_permission_barrier(
            ctx.user_id, ctx.org_id, action
        ) as allowed:
            if not allowed:
                raise HTTPException(403, detail="Organization access is inactive")
            yield ctx

    return cast(autogpt_auth_lib.RequestContext, live_dependency(dependency))


async def resolve_write_team_id(
    user_id: str, organization_id: str | None, team_id: str | None
) -> str | None:
    """Validate an explicitly-requested team_id for a create/save.

    Returns ``team_id`` when the caller is an ACTIVE member of a team that
    belongs to ``organization_id`` (which is what makes it stampable), and
    ``None`` when no team was requested (org-home). Raises HTTP 400 for a
    team the caller may not write into — a team in another org, or one the
    caller is not an active member of. Org admins are not exempt: creating
    into a team requires membership (join the team first).

    Validation convention across the write paths: caller-supplied team ids
    (request body / query param) always go through here, while
    ``ctx.team_id`` arrives pre-validated by ``get_request_context`` (which
    resolves an unusable X-Team-Id header to None) and is therefore trusted
    directly. ``create_api_key`` is the one exception — see the comment
    there.
    """
    if team_id is None:
        return None
    if not organization_id:
        raise HTTPException(
            status_code=400,
            detail="No organization context available for team assignment.",
        )
    if team_id not in await get_user_team_ids(user_id, organization_id):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid team_id: it must be a team in your organization that "
                "you are an active member of."
            ),
        )
    await require_personal_scope_without_collaboration(
        user_id, organization_id, team_id
    )
    return team_id
