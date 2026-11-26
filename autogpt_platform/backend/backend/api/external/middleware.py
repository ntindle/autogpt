from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated, Optional, cast

from autogpt_libs.auth import reject_closed_account
from autogpt_libs.auth.dependencies import ACCOUNT_BANNED_DETAIL
from autogpt_libs.auth.permissions import OrgAction, TeamAction
from fastapi import FastAPI, HTTPException, Request, Security, status
from fastapi.params import Depends as DependsParameter
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from prisma.enums import APIKeyPermission, APIKeyStatus
from prisma.models import APIKey as PrismaAPIKey
from prisma.models import OAuthAccessToken as PrismaOAuthAccessToken
from prisma.models import OAuthApplication as PrismaOAuthApplication
from pydantic import BaseModel, ConfigDict
from starlette.types import Scope

from backend.api.external.auth_rate_limit import (
    APIKeyValidationBudget,
    enforce_api_key_validate_rate_limit,
    refund_api_key_validate_rate_limit,
)
from backend.api.features.orgs.db import get_user_default_team, is_active_member
from backend.api.live_auth import live_dependency
from backend.api.org_rollout import require_personal_scope
from backend.data.auth.api_key import APIKeyInfo, validate_api_key
from backend.data.auth.base import APIAuthorizationInfo
from backend.data.auth.oauth import (
    InvalidClientError,
    InvalidTokenError,
    OAuthAccessTokenInfo,
    OAuthApplicationInfo,
    is_access_token,
    validate_access_token,
)
from backend.data.db import prisma
from backend.data.tenancy import (
    ResourceAccess,
    has_live_resource_access,
    has_live_resource_permission,
    live_request_transaction,
    resource_role_refusal,
)
from backend.data.user import is_user_banned
from backend.util.cache import cached

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_auth = HTTPBearer(auto_error=False)

_REQUEST_AUTH = "external_api_auth"

FORMER_MEMBER_DETAIL = (
    "These credentials belong to an organization or team you are not an active "
    "member of"
)
NO_ORGANIZATION_DETAIL = (
    "No organization context available. Your account may be in an inconsistent "
    "state — please contact support."
)

# How long a membership answer is reused. Nearly every key names an
# organization, and the rate limiter and the route each check the caller, so
# without it every request would read the membership twice. Removing a member
# revokes their keys there at once; the cache only delays the other ways a
# membership ends, such as a deleted organization, by this much.
MEMBERSHIP_CACHE_SECONDS = 10


def _auth_error(detail: str, status_code: int = status.HTTP_401_UNAUTHORIZED):
    return HTTPException(status_code=status_code, detail=detail)


@asynccontextmanager
async def _live_authorization_principal(
    auth: APIAuthorizationInfo,
    permissions: tuple[APIKeyPermission, ...],
    *,
    hold_until_return: bool = True,
) -> AsyncIterator[None]:
    async with live_request_transaction(prisma) as tx:
        if isinstance(auth, APIKeyInfo):
            locked = await tx.query_raw(
                'SELECT "id" FROM "APIKey" WHERE "id" = $1 FOR SHARE',
                auth.id,
            )
            if not locked:
                raise _auth_error("API key no longer exists")
            key = await PrismaAPIKey.prisma(tx).find_unique(where={"id": auth.id})
            if key is None or key.status != APIKeyStatus.ACTIVE:
                raise _auth_error("API key is no longer active")
            if key.userId != auth.user_id:
                raise _auth_error("API key owner changed")
            live_permissions = {APIKeyPermission(value) for value in key.permissions}
            missing = [
                permission
                for permission in permissions
                if permission not in live_permissions
            ]
            if missing:
                raise _auth_error(
                    "API key permissions changed",
                    status.HTTP_403_FORBIDDEN,
                )
        elif isinstance(auth, OAuthAccessTokenInfo):
            app_locked = await tx.query_raw(
                'SELECT "id" FROM "OAuthApplication" WHERE "id" = $1 FOR SHARE',
                auth.application_id,
            )
            if not app_locked:
                raise _auth_error("OAuth application no longer exists")
            token_locked = await tx.query_raw(
                'SELECT "id" FROM "OAuthAccessToken" WHERE "id" = $1 FOR SHARE',
                auth.id,
            )
            if not token_locked:
                raise _auth_error("OAuth access token no longer exists")
            application = await PrismaOAuthApplication.prisma(tx).find_unique(
                where={"id": auth.application_id}
            )
            token = await PrismaOAuthAccessToken.prisma(tx).find_unique(
                where={"id": auth.id}
            )
            if application is None or not application.isActive:
                raise _auth_error("OAuth application is no longer active")
            if (
                token is None
                or token.applicationId != auth.application_id
                or token.userId != auth.user_id
                or token.revokedAt is not None
                or token.expiresAt <= datetime.now(timezone.utc)
            ):
                raise _auth_error("OAuth access token is no longer active")
            live_token_permissions = {APIKeyPermission(value) for value in token.scopes}
            live_app_permissions = {
                APIKeyPermission(value) for value in application.scopes
            }
            missing = [
                permission
                for permission in permissions
                if permission not in live_token_permissions
                or permission not in live_app_permissions
            ]
            if missing:
                raise _auth_error(
                    "OAuth permissions changed",
                    status.HTTP_403_FORBIDDEN,
                )
        else:
            raise _auth_error("Unsupported authorization principal")
        if hold_until_return:
            yield
            return
    yield
    async with _live_authorization_principal(auth, permissions):
        pass


async def _scope_api_key(api_key: APIAuthorizationInfo) -> APIAuthorizationInfo:
    if api_key.organization_id is None and api_key.team_id_restriction is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API key has an invalid workspace scope",
        )
    return await _in_personal_scope(
        api_key, api_key.organization_id, api_key.team_id_restriction
    )


async def _scope_oauth_token(
    token: APIAuthorizationInfo, application: OAuthApplicationInfo
) -> APIAuthorizationInfo:
    if (
        application.organization_id is None
        and application.team_id_restriction is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="OAuth application has an invalid workspace scope",
        )
    return await _in_personal_scope(
        token, application.organization_id, application.team_id_restriction
    )


async def _in_personal_scope(
    auth: APIAuthorizationInfo, organization_id: str | None, team_id: str | None
) -> APIAuthorizationInfo:
    """Pin a credential to the caller's personal default team, the only scope
    a credential acts in for now; any other scope it names is refused."""
    organization_id, team_id = await require_personal_scope(
        auth.user_id, organization_id, team_id
    )
    return auth.model_copy(
        update={"organization_id": organization_id, "team_id_restriction": team_id}
    )


class VerifiedCredential(BaseModel):
    """What this request's credential verified as: who, or rejected."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    credential: Optional[str]
    auth: Optional[APIAuthorizationInfo] = None
    rejection: Optional[HTTPException] = None


class _VerifiedPrincipal(BaseModel):
    """A verified credential, with the OAuth application a token was issued to."""

    auth: APIAuthorizationInfo
    application: OAuthApplicationInfo | None = None


async def resolve_auth_info(
    api_key: str | None = Security(api_key_header),
    bearer: HTTPAuthorizationCredentials | None = Security(bearer_auth),
    *,
    before_api_key_verify: Callable[[], Awaitable[None]] | None = None,
) -> APIAuthorizationInfo | None:
    """
    Resolve authentication from API key or Bearer token headers.

    Returns the auth info if valid credentials are provided, or None if no
    credentials are present. Raises HTTPException on *invalid* credentials.
    The credential is not pinned to a tenant here: v1 does that in
    `require_auth`, v2 in its own tenancy resolution.
    """
    principal = await _verify_principal(
        api_key, bearer, before_api_key_verify=before_api_key_verify
    )
    return principal.auth if principal is not None else None


async def _verify_principal(
    api_key: str | None,
    bearer: HTTPAuthorizationCredentials | None,
    *,
    before_api_key_verify: Callable[[], Awaitable[None]] | None = None,
) -> _VerifiedPrincipal | None:
    key = _plaintext_api_key(api_key, bearer)
    if key is not None:
        api_key_info = (
            await validate_api_key(key, before_verify=before_api_key_verify)
            if before_api_key_verify is not None
            else await validate_api_key(key)
        )
        if api_key_info:
            await reject_closed_account(api_key_info.user_id)
            await _refuse_banned_owner(api_key_info)
            return _VerifiedPrincipal(auth=api_key_info)
        if api_key is not None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key"
            )

    if bearer is not None:
        try:
            token_info, application = await validate_access_token(bearer.credentials)
        except (InvalidClientError, InvalidTokenError) as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
        await reject_closed_account(token_info.user_id)
        await _refuse_banned_owner(token_info)
        return _VerifiedPrincipal(auth=token_info, application=application)

    return None


async def _resolve_personal_auth_info(
    api_key: str | None,
    bearer: HTTPAuthorizationCredentials | None,
    *,
    before_api_key_verify: Callable[[], Awaitable[None]] | None = None,
) -> APIAuthorizationInfo | None:
    principal = await _verify_principal(
        api_key, bearer, before_api_key_verify=before_api_key_verify
    )
    if principal is None:
        return None
    if principal.application is not None:
        return await _scope_oauth_token(principal.auth, principal.application)
    return await _scope_api_key(principal.auth)


async def resolve_request_auth(
    scope: Scope,
    api_key: str | None,
    bearer: HTTPAuthorizationCredentials | None,
    *,
    personal_only: bool = False,
    before_api_key_verify: Callable[[], Awaitable[None]] | None = None,
) -> APIAuthorizationInfo | None:
    """`resolve_auth_info`, verified at most once per request.

    v2's rate limiter and route dependency both need the caller, and an API key
    costs a Scrypt hash per check. A rejection is remembered too, so an invalid
    key costs one hash, not two; an error that isn't a rejection (the database
    unreachable) is not, so the route's own check tries again. The result is
    kept with the credential it was for, and only reused for that credential.
    """
    credential = (
        api_key if api_key is not None else bearer.credentials if bearer else None
    )
    state = scope.setdefault("state", {})
    cache_key = _REQUEST_AUTH + (":personal" if personal_only else "")
    verified = state.get(cache_key)
    if not isinstance(verified, VerifiedCredential) or (
        verified.credential != credential
    ):
        try:
            verified = VerifiedCredential(
                credential=credential,
                auth=await (
                    _resolve_personal_auth_info(
                        api_key, bearer, before_api_key_verify=before_api_key_verify
                    )
                    if personal_only
                    else resolve_auth_info(
                        api_key=api_key,
                        bearer=bearer,
                        before_api_key_verify=before_api_key_verify,
                    )
                ),
            )
        except HTTPException as rejection:
            verified = VerifiedCredential(credential=credential, rejection=rejection)
        state[cache_key] = verified
    if verified.rejection is not None:
        raise HTTPException(
            status_code=verified.rejection.status_code,
            detail=verified.rejection.detail,
            headers=verified.rejection.headers,
        )
    return verified.auth


def verified_credential(scope: Scope) -> Optional[VerifiedCredential]:
    """What this request's credential already verified as, if it was checked."""
    verified = scope.get("state", {}).get(_REQUEST_AUTH)
    return verified if isinstance(verified, VerifiedCredential) else None


async def require_auth(
    request: Request,
    api_key: Annotated[str | None, Security(api_key_header)] = None,
    bearer: Annotated[
        HTTPAuthorizationCredentials | None, Security(bearer_auth)
    ] = None,
) -> APIAuthorizationInfo:
    """The request's verified caller; 401 when it sent no credentials.

    Resolved once per request: v1's rate limiter and its routes ask for it under
    different scopes, which FastAPI caches apart. Verifying an API key first
    reserves from v1's pre-Scrypt budget, which a valid key gets back. The
    membership check below runs on every call, stored result or not, so
    credentials whose owner has left the organization or team they were issued
    in are refused, and like a closed or banned account's key they keep their
    reservation. Every v1 route reaches this, directly or through
    `require_permission`.
    """
    key = _plaintext_api_key(api_key, bearer)
    budget: APIKeyValidationBudget | None = None

    async def reserve() -> None:
        nonlocal budget
        if key is not None:
            budget = await enforce_api_key_validate_rate_limit(request, key)

    auth = await resolve_request_auth(
        request.scope,
        api_key=api_key,
        bearer=bearer,
        before_api_key_verify=reserve,
        personal_only=True,
    )
    if auth is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication. Provide API key or access token.",
        )
    await _refuse_former_member(auth)
    await refund_api_key_validate_rate_limit(budget)
    return auth


def _plaintext_api_key(
    api_key: str | None, bearer: HTTPAuthorizationCredentials | None
) -> str | None:
    """Prefer an explicit API key while supporting Bearer-only MCP clients."""
    if api_key is not None:
        return api_key
    if bearer is not None and not is_access_token(bearer.credentials):
        return bearer.credentials
    return None


async def _refuse_banned_owner(auth: APIAuthorizationInfo) -> None:
    if await owner_is_banned(auth):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=ACCOUNT_BANNED_DETAIL
        )


async def owner_is_banned(auth: APIAuthorizationInfo) -> bool:
    """Whether the account a credential belongs to is banned; for verifiers that
    resolve credentials outside `resolve_auth_info`, such as v2's MCP server."""
    return await is_user_banned(auth.user_id)


async def _refuse_former_member(auth: APIAuthorizationInfo) -> None:
    """Refuse a credential issued in an organization or team its owner has left.

    v1 acts in the organization and team stored on the credential, so it is
    good only while its owner is an active member of both, as v2 checks too.
    It is refused, never moved to the owner's personal organization, which it
    wasn't issued for. A credential that names no organization (a key made
    before organizations existed) acts in that personal organization, so there
    is nothing to check; one that names a team but no organization is refused.
    """
    if auth.organization_id is None and auth.team_id_restriction is None:
        return
    if auth.organization_id is None or not await holds_membership(
        auth.user_id, auth.organization_id, auth.team_id_restriction
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=FORMER_MEMBER_DETAIL
        )


@cached(maxsize=1000, ttl_seconds=MEMBERSHIP_CACHE_SECONDS)
async def holds_membership(
    user_id: str, organization_id: str, team_id: str | None
) -> bool:
    """`is_active_member`, reused for `MEMBERSHIP_CACHE_SECONDS`."""
    return await is_active_member(user_id, organization_id, team_id)


def permission_dependency(
    *permissions: APIKeyPermission, hold_until_return: bool = True
) -> DependsParameter:
    """
    Dependency function for checking required permissions.
    All listed permissions must be present.
    (works with API keys and OAuth tokens)
    """

    async def check_permissions(
        auth: APIAuthorizationInfo = Security(
            require_auth, scopes=[p.value for p in permissions]
        ),
    ) -> AsyncIterator[APIAuthorizationInfo]:
        missing = [p for p in permissions if p not in auth.scopes]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission(s): "
                f"{', '.join(p.value for p in missing)}",
            )
        async with _live_authorization_principal(
            auth, permissions, hold_until_return=hold_until_return
        ):
            integration_admin = any(
                permission
                in {
                    APIKeyPermission.MANAGE_INTEGRATIONS,
                    APIKeyPermission.DELETE_INTEGRATIONS,
                }
                for permission in permissions
            )
            if integration_admin:
                has_access = await has_live_resource_permission(
                    auth.user_id,
                    auth.organization_id,
                    auth.team_id_restriction,
                    OrgAction.MANAGE_CREDENTIALS,
                    TeamAction.MANAGE_CREDENTIALS,
                )
            elif (access := _resource_access_for_permissions(permissions)) is not None:
                has_access = await has_live_resource_access(
                    auth.user_id,
                    auth.organization_id,
                    auth.team_id_restriction,
                    access,
                )
            else:
                has_access = True
            if auth.organization_id is None or not has_access:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="The principal no longer has access to this resource scope",
                )
            yield auth

    return live_dependency(check_permissions)


def require_permission(
    *permissions: APIKeyPermission, hold_until_return: bool = True
) -> APIAuthorizationInfo:
    return cast(
        APIAuthorizationInfo,
        permission_dependency(*permissions, hold_until_return=hold_until_return),
    )


def _resource_access_for_permissions(
    permissions: tuple[APIKeyPermission, ...],
) -> ResourceAccess | None:
    if any(
        permission
        in {
            APIKeyPermission.EXECUTE_GRAPH,
            APIKeyPermission.EXECUTE_BLOCK,
            APIKeyPermission.USE_TOOLS,
        }
        for permission in permissions
    ):
        return "execute"
    if any(
        permission
        in {
            APIKeyPermission.WRITE_GRAPH,
            APIKeyPermission.WRITE_LIBRARY,
        }
        for permission in permissions
    ):
        return "create"
    if any(
        permission
        in {
            APIKeyPermission.READ_GRAPH,
            APIKeyPermission.READ_INTEGRATIONS,
        }
        for permission in permissions
    ):
        return "view"
    return None


def require_resource_permission(*permissions: APIKeyPermission):
    """`require_permission`, for routes that create, run or read workflows and
    runs in the credential's organization and team.

    The web app holds these to the caller's role there: a membership whose only
    role is billing manager covers spend, not workflows and runs. A credential
    that names no organization acts in its owner's personal organization, which
    its owner owns, so the route gets it bound to that organization's home.
    """

    async def check_resource_role(
        auth: APIAuthorizationInfo = require_permission(*permissions),
    ) -> APIAuthorizationInfo:
        if not auth.organization_id:
            return await _in_personal_organization(auth)
        if reason := await resource_role_refusal(
            auth.user_id, auth.organization_id, auth.team_id_restriction
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=reason)
        return auth

    return check_resource_role


async def _in_personal_organization(
    auth: APIAuthorizationInfo,
) -> APIAuthorizationInfo:
    organization_id, _ = await get_user_default_team(auth.user_id)
    if organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=NO_ORGANIZATION_DETAIL
        )
    return auth.model_copy(update={"organization_id": organization_id})


def add_auth_responses_to_openapi(app: FastAPI) -> None:
    """
    Add 401 responses to all endpoints secured with `require_auth` (v1) or
    v2's tenancy dependencies.
    """
    from autogpt_libs.auth.helpers import add_auth_responses_to_openapi

    add_auth_responses_to_openapi(
        app, [api_key_header.scheme_name, bearer_auth.scheme_name]
    )
