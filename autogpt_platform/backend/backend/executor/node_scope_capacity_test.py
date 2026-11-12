import asyncio
import threading
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.data import tenancy
from backend.data.db_accessors import LiveResourceAccessGuard, LiveResourceAccessRevoked
from backend.data.execution import ExecutionContext, ExecutionStatus, NodeExecutionEntry
from backend.data.model import GraphExecutionStats, NodeExecutionStats
from backend.executor.manager import ExecutionProcessor


@pytest.mark.asyncio
async def test_running_nodes_release_dispatch_capacity_for_other_accounts(mocker):
    @asynccontextmanager
    async def allowed(*_args, **_kwargs):
        yield True

    mocker.patch.object(tenancy, "live_resource_access_barrier", allowed)
    client = MagicMock(
        has_live_resource_access=AsyncMock(return_value=True),
        release_live_resource_lease=tenancy.release_live_resource_lease,
        get_node=AsyncMock(return_value=MagicMock()),
    )
    mocker.patch("backend.executor.manager.get_db_async_client", return_value=client)
    processor = ExecutionProcessor()
    started = asyncio.Barrier(4)
    release = asyncio.Event()

    async def run(**_kwargs):
        await started.wait()
        await release.wait()
        return SimpleNamespace(wall_time=0, cpu_time=0), ExecutionStatus.COMPLETED

    processor._on_node_execution = AsyncMock(side_effect=run)
    processor._settle_node = AsyncMock(return_value=NodeExecutionStats())
    leases = [
        await tenancy.acquire_live_resource_lease(f"owner-{i}", "org", None, "execute")
        for i in range(3)
    ]
    tasks = []
    try:
        for i, lease in enumerate(leases):
            entry = NodeExecutionEntry(
                user_id=f"owner-{i}",
                graph_exec_id=f"run-{i}",
                graph_id="graph",
                graph_version=1,
                node_exec_id=f"node-run-{i}",
                node_id="node",
                block_id="block",
                inputs={},
                execution_context=ExecutionContext(organization_id="org"),
            )
            tasks.append(
                asyncio.create_task(
                    processor._run_node(
                        entry,
                        MagicMock(),
                        MagicMock(),
                        None,
                        (GraphExecutionStats(), threading.Lock()),
                        None,
                        MagicMock(),
                        lease,
                    )
                )
            )
        await asyncio.wait_for(started.wait(), 10)
        other = await asyncio.wait_for(
            tenancy.acquire_live_resource_lease(
                "other-owner", "other-org", None, "execute"
            ),
            10,
        )
        assert other is not None
        assert all(not task.done() for task in tasks)
        assert await tenancy.release_live_resource_lease(other)
        release.set()
        await asyncio.wait_for(asyncio.gather(*tasks), 10)
    finally:
        release.set()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await tenancy.release_all_live_resource_leases()


@pytest.mark.asyncio
async def test_scope_guard_cancels_running_work_when_membership_changes():
    started = asyncio.Event()
    cancelled = asyncio.Event()
    client = MagicMock()

    async def current_access(*_args):
        return not started.is_set()

    client.has_live_resource_access = AsyncMock(side_effect=current_access)
    guard = LiveResourceAccessGuard(client, "owner", "org", "team", "execute")
    guard.check_interval = 0.01

    async def action():
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    with pytest.raises(LiveResourceAccessRevoked):
        await asyncio.wait_for(guard.run(action()), 10)
    assert cancelled.is_set()
    client.acquire_live_resource_lease.assert_not_called()
