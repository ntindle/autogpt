from typing import Optional

import pydantic

from backend.data.auth.api_key import APIKeyInfo, APIKeyPermission


class CreateAPIKeyRequest(pydantic.BaseModel):
    name: str
    permissions: list[APIKeyPermission]
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
    permissions: list[APIKeyPermission]
