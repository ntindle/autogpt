from unittest.mock import AsyncMock

import pytest

from backend.api.features.tasks import service
from backend.util.exceptions import UserPaywalledError


@pytest.mark.asyncio
@pytest.mark.parametrize("org_id", [None, "saved-business"])
async def test_admission_uses_saved_org_plan_and_counters(monkeypatch, org_id):
    entitlement = AsyncMock()
    limits = AsyncMock(return_value=(100, 200, "PRO"))
    check = AsyncMock()
    monkeypatch.setattr(service, "enforce_entitlement", entitlement)
    monkeypatch.setattr(service, "get_global_rate_limits", limits)
    monkeypatch.setattr(service, "check_rate_limit", check)
    await service._admit("owner", "platform", organization_id=org_id)
    entitlement.assert_awaited_once_with("owner", org_id)
    assert limits.await_args.args[-1] == org_id
    check.assert_awaited_once_with(
        user_id="owner",
        daily_cost_limit=100,
        weekly_cost_limit=200,
        expected_tier="PRO",
        org_id=org_id,
    )


@pytest.mark.asyncio
async def test_org_refusal_prevents_admitting_against_personal_limits(monkeypatch):
    entitlement = AsyncMock(
        side_effect=UserPaywalledError("Organization plan required")
    )
    limits = AsyncMock()
    monkeypatch.setattr(service, "enforce_entitlement", entitlement)
    monkeypatch.setattr(service, "get_global_rate_limits", limits)
    with pytest.raises(UserPaywalledError):
        await service._admit("owner", "platform", organization_id="business")
    limits.assert_not_awaited()
