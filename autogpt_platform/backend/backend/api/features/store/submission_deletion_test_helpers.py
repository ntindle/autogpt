"""Prisma responses for store and external API submission deletion tests."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, Mock

import prisma.models
from prisma.enums import SubmissionStatus
from pytest_mock import MockerFixture

from . import db


def mock_submission_deletion(
    mocker: MockerFixture,
    *,
    owning_user_id: str | None,
    owning_org_id: str | None = None,
    status: SubmissionStatus = SubmissionStatus.PENDING,
) -> tuple[AsyncMock, AsyncMock]:
    tx = AsyncMock()
    mocker.patch.object(db, "transaction").return_value.__aenter__.return_value = tx
    tx.query_raw.return_value = (
        [Mock(id="sl-1", owningUserId=owning_user_id, owningOrgId=owning_org_id)]
        if owning_user_id is not None
        else []
    )

    @asynccontextmanager
    async def allowed(*args, **kwargs):
        yield True

    mocker.patch.object(db, "live_agent_graph_access_barrier", allowed)
    listing = Mock(id="sl-1", owningUserId=owning_user_id, owningOrgId=owning_org_id)
    graph = Mock(
        id="graph-1",
        version=1,
        userId=owning_user_id,
        organizationId=owning_org_id,
        teamId=None,
    )
    versions = AsyncMock()
    versions.find_unique.return_value = (
        Mock(
            id="slv-1",
            storeListingId="sl-1",
            AgentGraph=graph,
            agentGraphId=graph.id,
            agentGraphVersion=1,
            StoreListing=listing,
            submissionStatus=status,
        )
        if owning_user_id
        else None
    )
    versions.delete_many.return_value = int(status != SubmissionStatus.APPROVED)
    versions.count.return_value = 1
    mocker.patch.object(
        prisma.models.StoreListingVersion, "prisma", return_value=versions
    )
    return tx, versions
