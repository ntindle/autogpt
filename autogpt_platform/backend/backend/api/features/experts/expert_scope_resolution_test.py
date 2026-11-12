from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.api.features.experts import experts_db


@pytest.mark.asyncio
async def test_resolve_expert_for_graph_filters_exact_library_scope(mocker) -> None:
    client = MagicMock(find_many=AsyncMock(return_value=[]))
    mocker.patch(
        "prisma.models.ExpertWorkflow.prisma",
        return_value=client,
    )

    assert (
        await experts_db.resolve_expert_for_graph(
            "user-1",
            "graph-1",
            organization_id="org-1",
            team_id="team-b",
            enforce_scope=True,
        )
        is None
    )

    library_filter = client.find_many.await_args.kwargs["where"]["LibraryAgent"]["is"]
    assert library_filter == {
        "userId": "user-1",
        "agentGraphId": "graph-1",
        "isDeleted": False,
        "organizationId": "org-1",
        "teamId": "team-b",
    }


@pytest.mark.asyncio
async def test_active_expert_ids_preserve_private_saved_scope(mocker) -> None:
    rows = [
        SimpleNamespace(id="allowed", organizationId="org-a", teamId="team-a"),
        SimpleNamespace(id="revoked", organizationId="org-b", teamId="team-b"),
        SimpleNamespace(id="legacy", organizationId=None, teamId=None),
    ]
    client = MagicMock(find_many=AsyncMock(return_value=rows))
    mocker.patch("prisma.models.Expert.prisma", return_value=client)
    access = mocker.patch.object(
        experts_db, "has_live_resource_access", new=AsyncMock(side_effect=[True, False])
    )

    assert await experts_db.active_expert_ids(
        "owner", {"allowed", "revoked", "legacy"}
    ) == {"allowed"}
    where = client.find_many.await_args.kwargs["where"]
    assert where["ownerUserId"] == "owner"
    assert where["visibility"] == "PRIVATE"
    assert [call.args for call in access.await_args_list] == [
        ("owner", "org-a", "team-a", "execute"),
        ("owner", "org-b", "team-b", "execute"),
    ]
