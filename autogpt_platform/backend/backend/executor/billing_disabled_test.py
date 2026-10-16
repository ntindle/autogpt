from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from backend.data import org_credit
from backend.executor import billing


@pytest.mark.parametrize("execution_count", [0, 1, 100, 1000])
def test_disabled_credits_skip_paid_dynamic_and_execution_charges(
    monkeypatch, execution_count
):
    monkeypatch.setattr(billing.settings.config, "enable_credit", False)
    client = Mock(
        side_effect=AssertionError("Disabled billing must not access wallets")
    )
    monkeypatch.setattr(billing, "get_db_client", client)
    monkeypatch.setattr(
        billing,
        "resolve_block_cost",
        Mock(side_effect=AssertionError("No platform charge")),
    )
    node = SimpleNamespace(
        execution_context=SimpleNamespace(organization_id="new-org", expert_id="expert")
    )
    assert billing.charge_usage(node, execution_count) == (0, 0, 0)
    client.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("preflight", [0, 100])
async def test_disabled_reconciliation_neither_charges_nor_refunds(
    monkeypatch, preflight
):
    monkeypatch.setattr(billing.settings.config, "enable_credit", False)
    client = Mock(side_effect=AssertionError("No reconciliation RPC"))
    monkeypatch.setattr(billing, "get_database_manager_async_client", client)
    assert await billing.charge_reconciled_usage(Mock(), Mock(), preflight) == (0, 0)
    client.assert_not_called()


@pytest.mark.asyncio
async def test_disabled_org_wallet_reads_and_writes_match_user_mode(monkeypatch):
    monkeypatch.setattr(org_credit.settings.config, "enable_credit", False)
    lookup = AsyncMock(side_effect=AssertionError("No org wallet lookup"))
    monkeypatch.setattr(org_credit, "_personal_org_owner", lookup)
    assert await org_credit.get_org_credits("empty-new-org") > 0
    for cost in (0, 1, 100, -100):
        assert await org_credit.spend_org_credits("empty-new-org", "owner", cost) == 0
    lookup.assert_not_awaited()
