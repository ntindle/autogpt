from unittest.mock import AsyncMock, patch

import pytest

from .scope import MemoryScope
from .tiers import resolve_search_targets, resolve_warm_targets


def test_org_scope_roundtrip_keeps_owner_org_and_expert_separate():
    scopes = [
        MemoryScope.build(user, expert, organization_id=org)
        for user in ("owner", "other")
        for org in (None, "autogpt", "denton")
        for expert in (None, "reviewer")
    ]
    assert len({scope.group_id for scope in scopes}) == len(scopes) - 1
    for scope in scopes:
        assert MemoryScope.model_validate_json(scope.model_dump_json()) == scope
    assert MemoryScope.build("owner").group_id == "user_owner"
    for family in ("dream_lock", "last_completed", "rebuild_lock"):
        assert len({scope.redis_key(family) for scope in scopes[:6]}) == 6


@pytest.mark.asyncio
async def test_new_org_never_reads_original_personal_memory():
    with patch("backend.copilot.graphiti.scope_resolution.memory_db") as db, patch(
        "backend.copilot.graphiti.tiers.shared_memory_enabled",
        AsyncMock(return_value=False),
    ):
        db.return_value.get_personal_memory_organization = AsyncMock(
            return_value="personal"
        )
        warm = await resolve_warm_targets("owner", "denton", None)
        search = await resolve_search_targets("owner", "denton", "all")
    assert warm[0].group_id == search[0].group_id
    assert warm[0].group_id != MemoryScope.for_user("owner").group_id


@pytest.mark.asyncio
async def test_expert_ownership_and_saved_org_are_rechecked():
    from types import SimpleNamespace

    from . import scope_resolution

    original = MemoryScope.build("owner", "expert")
    business = MemoryScope.build("owner", "expert", "denton")
    with patch.object(scope_resolution, "experts_db") as db:
        getter = db.return_value.get_expert = AsyncMock(
            return_value=SimpleNamespace(organization_id="denton")
        )
        assert await scope_resolution.owns_memory_scope(business)
        assert not await scope_resolution.owns_memory_scope(original)
        getter.return_value = None
        assert not await scope_resolution.owns_memory_scope(business)
        getter.assert_awaited_with("owner", "expert", include_workflows=False)


@pytest.mark.asyncio
async def test_delayed_private_payload_rejects_missing_and_foreign_scope():
    from . import ingest

    scope = MemoryScope.build("owner", organization_id="denton")
    with patch.object(ingest, "get_graphiti_client", AsyncMock()) as client:
        for actor, saved in (("owner", None), ("intruder", scope.model_dump())):
            with pytest.raises(ingest.MemoryScopeViolationError):
                await ingest._process_ingestion_payload(
                    actor,
                    scope.group_id,
                    {
                        "group_id": scope.group_id,
                        "_memory_scope": saved,
                    },
                )
        client.assert_not_awaited()


@pytest.mark.asyncio
async def test_legacy_scope_never_resolves_from_navigation():
    from . import scope_resolution

    with patch.object(scope_resolution, "memory_db") as db:
        db.return_value.get_personal_memory_organization = AsyncMock(
            return_value="org-1"
        )
        assert await scope_resolution.resolve_memory_scope(
            "owner"
        ) == MemoryScope.for_user("owner")
        db.return_value.get_personal_memory_organization.assert_not_awaited()
        assert await scope_resolution.resolve_memory_scope(
            "owner", "expert", "org-1"
        ) == MemoryScope.for_expert("owner", "expert")
        assert await scope_resolution.resolve_memory_scope(
            "owner", "expert", "denton"
        ) != MemoryScope.for_expert("owner", "expert")
