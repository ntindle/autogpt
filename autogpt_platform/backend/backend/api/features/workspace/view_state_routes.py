"""Edits to saved OpenUI view files (``.openui``)."""

from typing import Annotated

from autogpt_libs import auth
from autogpt_libs.auth.dependencies import get_user_id, requires_user
from fastapi import APIRouter, Security

from backend.copilot.ui_view_files import (
    UIFileStateResponse,
    UIFileStateWrite,
    read_file_state,
    write_file_state,
)

router = APIRouter(dependencies=[Security(requires_user)])
UserID = Annotated[str, Security(get_user_id)]
Context = Annotated[auth.RequestContext, Security(auth.get_request_context)]


@router.get(
    "/files/{file_id}/view-state",
    summary="Get a saved view and its edits",
    operation_id="getWorkspaceFileViewState",
    responses={404: {"description": "Saved view not found"}},
)
async def get_file_view_state(
    file_id: str, user_id: UserID, ctx: Context
) -> UIFileStateResponse:
    return await read_file_state(
        user_id, file_id, organization_id=ctx.org_id, team_id=ctx.team_id
    )


@router.put(
    "/files/{file_id}/view-state",
    summary="Save edits to a saved view",
    operation_id="putWorkspaceFileViewState",
    responses={
        404: {"description": "Saved view not found"},
        409: {"description": "The view or its edits changed; reload first"},
    },
)
async def put_file_view_state(
    file_id: str, user_id: UserID, request: UIFileStateWrite, ctx: Context
) -> UIFileStateResponse:
    return await write_file_state(
        user_id, file_id, request, organization_id=ctx.org_id, team_id=ctx.team_id
    )
