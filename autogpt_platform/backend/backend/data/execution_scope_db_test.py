import asyncio
import os
from uuid import uuid4

import pytest
import pytest_asyncio
from prisma import Prisma
from prisma.enums import APIKeyPermission

from backend.data import execution
from backend.data.auth import api_key
from backend.data.db import DATABASE_URL, add_param, prisma

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(
        os.environ.get("RUN_ORG_ISOLATION_DB_TESTS") != "1",
        reason="Requires an isolated migrated PostgreSQL database",
    ),
]


@pytest_asyncio.fixture
async def owners():
    await prisma.connect()
    users = []
    try:
        for _ in range(2):
            identifier = str(uuid4())
            users.append(
                await prisma.user.create(
                    data={"id": identifier, "email": f"{identifier}@example.invalid"}
                )
            )
        yield users
    finally:
        for user in users:
            await prisma.user.delete(where={"id": user.id})
        await prisma.disconnect()


async def test_team_filter_preserves_private_run_visibility_in_postgres(owners):
    owner, reader = owners
    org = await prisma.organization.create(
        data={"name": "Fixture", "slug": str(uuid4())}
    )
    try:
        team = await prisma.team.create(data={"name": "Fixture", "orgId": org.id})
        for user in owners:
            await prisma.orgmember.create(
                data={"userId": user.id, "orgId": org.id, "status": "ACTIVE"}
            )
            await prisma.teammember.create(
                data={"userId": user.id, "teamId": team.id, "status": "ACTIVE"}
            )
        expert = await prisma.expert.create(
            data={
                "name": "Private",
                "role": "Fixture",
                "identity": "Fixture",
                "ownerUserId": owner.id,
                "organizationId": org.id,
                "teamId": team.id,
            }
        )
        graph = await prisma.agentgraph.create(
            data={
                "userId": owner.id,
                "organizationId": org.id,
                "teamId": team.id,
            }
        )
        runs = []
        for expert_id in (expert.id, None):
            runs.append(
                await prisma.agentgraphexecution.create(
                    data={
                        "userId": owner.id,
                        "organizationId": org.id,
                        "teamId": team.id,
                        "agentGraphId": graph.id,
                        "agentGraphVersion": graph.version,
                        "expertId": expert_id,
                    }
                )
            )
        private, shared = runs
        scope = {"organization_id": org.id, "team_id_restriction": team.id}
        page = await execution.get_graph_executions_paginated(
            reader.id, statuses=[execution.ExecutionStatus.COMPLETED], **scope
        )
        assert [item.id for item in page.executions] == [shared.id]
        assert page.pagination.total_items == 1
        assert (
            await execution.get_graph_execution_meta(reader.id, private.id, **scope)
            is None
        )
        assert (
            await execution.get_graph_execution(reader.id, private.id, True, **scope)
            is None
        )
        assert (
            await execution.get_graph_execution(owner.id, private.id, True, **scope)
            is not None
        )
        assert (
            await execution.get_graph_execution(reader.id, shared.id, True, **scope)
            is not None
        )
    finally:
        await prisma.agentgraphexecution.delete_many(where={"organizationId": org.id})
        await prisma.agentgraph.delete_many(where={"organizationId": org.id})
        await prisma.expert.delete_many(where={"organizationId": org.id})
        await prisma.organization.delete(where={"id": org.id})


async def test_last_use_stamps_skip_a_locked_key_with_a_two_connection_pool(
    owners, mocker
):
    owner, _ = owners
    info, _ = await api_key.create_api_key(
        "Fixture", owner.id, [APIKeyPermission.READ_BLOCK]
    )
    row = await prisma.apikey.find_unique_or_raise(where={"id": info.id})
    key = api_key.APIKeyInfoWithHash.from_db(row)
    writer = Prisma(
        datasource={"url": add_param(DATABASE_URL, "connection_limit", "2")}
    )
    await writer.connect()
    mocker.patch.object(api_key, "prisma", writer)
    try:
        async with prisma.tx() as tx:
            await tx.query_raw(
                'SELECT "id" FROM "APIKey" WHERE "id" = $1 FOR SHARE', key.id
            )
            await asyncio.wait_for(
                asyncio.gather(*(api_key._record_use(key) for _ in range(4))), 10
            )
            assert key.last_used_at is None
            assert await asyncio.wait_for(
                writer.query_raw("SELECT 1 AS ready"), 10
            ) == [{"ready": 1}]
        await api_key._record_use(key)
        assert key.last_used_at is not None
        stamped = await prisma.apikey.find_unique_or_raise(where={"id": info.id})
        assert stamped.lastUsedAt is not None
        assert abs((stamped.lastUsedAt - key.last_used_at).total_seconds()) < 0.001
    finally:
        await writer.disconnect()
