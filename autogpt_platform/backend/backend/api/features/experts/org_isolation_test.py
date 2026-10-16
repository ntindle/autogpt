from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.api.features.experts import experts_db


@pytest.mark.asyncio
async def test_private_expert_uses_saved_business_org(mocker):
    row = SimpleNamespace(organizationId="denton", teamId="denton-default")
    mocker.patch(
        "prisma.models.Expert.prisma",
        return_value=MagicMock(find_first=AsyncMock(return_value=row)),
    )
    mocker.patch.object(
        experts_db,
        "get_user_default_team",
        AsyncMock(return_value=("personal", "personal-default")),
    )
    access = mocker.patch.object(
        experts_db,
        "has_live_resource_access",
        AsyncMock(return_value=True),
        create=True,
    )
    assert await experts_db.resolve_private_expert_tenancy("owner", "expert") == (
        "denton",
        "denton-default",
    )
    access.assert_awaited_once_with("owner", "denton", "denton-default", "execute")


@pytest.mark.asyncio
async def test_private_expert_denies_revoked_membership(mocker):
    row = SimpleNamespace(organizationId="personal", teamId="default")
    mocker.patch(
        "prisma.models.Expert.prisma",
        return_value=MagicMock(find_first=AsyncMock(return_value=row)),
    )
    mocker.patch.object(
        experts_db,
        "get_user_default_team",
        AsyncMock(return_value=("personal", "default")),
    )
    mocker.patch.object(
        experts_db,
        "has_live_resource_access",
        AsyncMock(return_value=False),
        create=True,
    )
    with pytest.raises(experts_db.ExpertPrivateTenancyNotFoundError):
        await experts_db.resolve_private_expert_tenancy("owner", "expert")
