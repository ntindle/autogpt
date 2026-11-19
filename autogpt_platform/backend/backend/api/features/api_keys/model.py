from typing import Annotated, Optional

import pydantic

from backend.data.auth.api_key import (
    OAUTH_ONLY_PERMISSIONS,
    APIKeyInfo,
    APIKeyPermission,
)


def _no_oauth_only_permissions(
    permissions: list[APIKeyPermission],
) -> list[APIKeyPermission]:
    oauth_only = sorted(set(permissions) & OAUTH_ONLY_PERMISSIONS)
    if oauth_only:
        raise ValueError(
            f"{', '.join(oauth_only)} can only be granted through OAuth, not to an "
            "API key"
        )
    return permissions


APIKeyPermissions = Annotated[
    list[APIKeyPermission], pydantic.AfterValidator(_no_oauth_only_permissions)
]


class CreateAPIKeyRequest(pydantic.BaseModel):
    name: str
    permissions: APIKeyPermissions
    description: Optional[str] = None
    team_id: Optional[str] = pydantic.Field(
        default=None,
        description=(
            "Restrict the key to a single team: it may only access that team's "
            "resources. Must be a team in the caller's org that the caller is an "
            "active member of. Omit to use the active team from the request "
            "context; with no active team the key is org-wide."
        ),
    )


class CreateAPIKeyResponse(pydantic.BaseModel):
    api_key: APIKeyInfo
    plain_text_key: str


class UpdatePermissionsRequest(pydantic.BaseModel):
    permissions: APIKeyPermissions
