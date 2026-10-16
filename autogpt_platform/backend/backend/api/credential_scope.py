from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from autogpt_libs.auth import OrgAction, RequestContext, TeamAction, get_request_context
from fastapi import HTTPException, Security

from backend.data.model import OAuthState
from backend.data.tenancy import live_resource_permission_barrier
from backend.integrations.credential_scope import credential_scope


async def credential_user_id(
    ctx: Annotated[RequestContext, Security(get_request_context)],
) -> AsyncIterator[str]:
    with credential_scope(ctx.org_id):
        yield ctx.user_id


@asynccontextmanager
async def oauth_credential_scope(
    user_id: str, state: OAuthState
) -> AsyncIterator[None]:
    async with live_resource_permission_barrier(
        user_id,
        state.organization_id,
        None,
        OrgAction.MANAGE_CREDENTIALS,
        TeamAction.MANAGE_CREDENTIALS,
    ) as allowed:
        if not allowed:
            raise HTTPException(403, detail="Connection organization is inactive")
        with credential_scope(state.organization_id):
            yield
