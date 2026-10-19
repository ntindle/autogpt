from collections.abc import Awaitable, Callable
from typing import TypeVar

from fastapi import HTTPException

from backend.api.features.experts.experts_db import owns_active_expert
from backend.copilot.db import get_chat_session_metadata
from backend.copilot.model import ChatSessionInfo
from backend.data.db_accessors import (
    LiveResourceAccessRevoked,
    live_resource_lease,
    require_exact_chat_session_scope,
)
from backend.data.tenancy import ResourceAccess

T = TypeVar("T")


async def run_view_action(
    user_id: str,
    organization_id: str | None,
    team_id: str | None,
    access: ResourceAccess,
    action: Callable[[], Awaitable[T]],
) -> T:
    try:
        async with live_resource_lease(
            user_id, organization_id, team_id, access
        ) as guard:
            if not guard:
                raise LiveResourceAccessRevoked("openui_access_revoked")
            return await guard.run(action())
    except LiveResourceAccessRevoked as error:
        raise HTTPException(404, "Interactive view not found") from error


async def run_session_view_action(
    user_id: str,
    session_id: str,
    access: ResourceAccess,
    action: Callable[[ChatSessionInfo], Awaitable[T]],
) -> T:
    session = await get_chat_session_metadata(session_id)
    if session is None or session.user_id != user_id:
        raise HTTPException(404, "Interactive view not found")

    async def run() -> T:
        await require_exact_chat_session_scope(
            session_id, user_id, session.organization_id, session.team_id
        )
        if (
            access != "view"
            and session.expert_id is not None
            and not await owns_active_expert(user_id, session.expert_id)
        ):
            raise HTTPException(404, "Interactive view not found")
        return await action(session)

    return await run_view_action(
        user_id, session.organization_id, session.team_id, access, run
    )
