from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.data import execution
from backend.data.execution import ExecutionStatus


@pytest.mark.asyncio
@pytest.mark.parametrize("surface", ["list", "meta", "detail", "nodes"])
async def test_team_execution_reads_keep_expert_runs_owner_private(mocker, surface):
    client = MagicMock(
        count=AsyncMock(return_value=0),
        find_many=AsyncMock(return_value=[]),
        find_first=AsyncMock(return_value=None),
    )
    mocker.patch.object(execution.AgentGraphExecution, "prisma", return_value=client)
    kwargs = {"organization_id": "org", "team_id_restriction": "team"}
    if surface == "list":
        result = await execution.get_graph_executions_paginated(
            "reader", statuses=[ExecutionStatus.COMPLETED], **kwargs
        )
        assert result.pagination.total_items == 0
        queries = [client.count.call_args, client.find_many.call_args]
    elif surface == "meta":
        assert (
            await execution.get_graph_execution_meta("reader", "run", **kwargs) is None
        )
        queries = [client.find_first.call_args]
    else:
        assert (
            await execution.get_graph_execution(
                "reader", "run", include_node_executions=surface == "nodes", **kwargs
            )
            is None
        )
        queries = [client.find_first.call_args]

    for query in queries:
        where = query.kwargs["where"]
        assert where["organizationId"] == "org"
        assert where["teamId"] == "team"
        assert {"OR": [{"expertId": None}, {"userId": "reader"}]} in where["AND"]
        if surface == "list":
            assert where["OR"] == [{"executionStatus": ExecutionStatus.COMPLETED}]
