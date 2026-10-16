from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.copilot.dream.nightly_batch import NightlyBatchResult

from . import maintenance
from .scope import MemoryScope


@pytest.mark.asyncio
async def test_persisted_scopes_drive_nightly_and_community_work(monkeypatch):
    scopes = [
        MemoryScope.for_user("owner"),
        MemoryScope.build("owner", organization_id="denton"),
        MemoryScope.build("owner", "reviewer", "denton"),
    ]
    monkeypatch.setattr(
        maintenance, "check_dream_budget", AsyncMock(return_value=(True, None))
    )
    store = MagicMock()
    store.list_memory_scopes = AsyncMock(return_value=scopes)
    monkeypatch.setattr(maintenance, "memory_db", lambda: store)
    authorized = []

    class Lease:
        async def run(self, action):
            return await action

    @asynccontextmanager
    async def access(scope):
        authorized.append(scope)
        yield Lease()

    async def nightly(user_id, **kwargs):
        return NightlyBatchResult(
            user_id=user_id, nightly_id="test", started_at=datetime.now(timezone.utc)
        )

    monkeypatch.setattr(maintenance, "memory_scope_access", access)
    submit = AsyncMock(side_effect=nightly)
    rebuild = AsyncMock(return_value={"error": None})
    learning = AsyncMock(return_value=None)
    monkeypatch.setattr(maintenance, "run_nightly_batch_submit", submit)
    monkeypatch.setattr(maintenance, "rebuild_communities_for_user", rebuild)
    monkeypatch.setattr(maintenance, "run_skill_learning_pass", learning)
    monkeypatch.setattr(maintenance, "is_feature_enabled", AsyncMock(return_value=True))
    result = await maintenance.run_all_memory_nightly("owner")
    assert set(result.scope_results) == {scope.scope_key for scope in scopes}
    assert [call.kwargs for call in submit.await_args_list] == [
        {
            "organization_id": scope.organization_id,
            "expert_id": scope.expert_id,
            "include_learning": False,
        }
        for scope in scopes
    ]
    learning.assert_awaited_once_with("owner", trigger="nightly")
    await maintenance.rebuild_all_memory_communities("owner")
    assert [call.kwargs for call in rebuild.await_args_list] == [
        {"organization_id": scope.organization_id, "expert_id": scope.expert_id}
        for scope in scopes
    ]
    assert authorized == scopes * 2


@pytest.mark.asyncio
async def test_nightly_budget_gate_also_covers_single_learning_pass(monkeypatch):
    monkeypatch.setattr(
        maintenance,
        "check_dream_budget",
        AsyncMock(return_value=(False, "insufficient_credits")),
    )
    learning = AsyncMock()
    monkeypatch.setattr(maintenance, "run_skill_learning_pass", learning)
    result = await maintenance.run_all_memory_nightly("owner")
    assert result.skipped
    learning.assert_not_awaited()
