"""Tests for the shared org/team visibility predicate."""

import asyncio
from contextlib import asynccontextmanager
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call

import pytest
from autogpt_libs.auth.permissions import OrgAction, TeamAction

from backend.data import tenancy
from backend.data.tenancy import (
    BILLING_ONLY_ORG_ROLE,
    BILLING_ONLY_TEAM_ROLE,
    get_user_team_ids,
    has_live_resource_access,
    is_own_personal_org,
    live_agent_graph_access_barrier,
    organization_filter,
    require_role_where_resource_lives,
    resource_role_refusal,
    visibility_filter,
    writable_organization_ids,
)
from backend.util.exceptions import NotAuthorizedError


def test_live_action_transaction_timeout_uses_real_minutes():
    assert tenancy.LIVE_ACTION_TRANSACTION_TIMEOUT == timedelta(minutes=31)


@pytest.mark.asyncio
async def test_live_transaction_lease_database_lifecycle_and_health(mocker):
    connected = False
    lease_client = MagicMock()

    def is_connected():
        return connected

    async def connect():
        nonlocal connected
        connected = True

    async def disconnect():
        nonlocal connected
        connected = False

    lease_client.is_connected.side_effect = is_connected
    lease_client.connect = AsyncMock(side_effect=connect)
    lease_client.disconnect = AsyncMock(side_effect=disconnect)
    lease_client.query_raw = AsyncMock(return_value=[{"health_check": 1}])
    mocker.patch.object(tenancy, "live_transaction_lease_prisma", lease_client)

    assert not tenancy.is_live_transaction_lease_database_connected()
    assert await tenancy.connect_live_transaction_lease_database()
    assert not await tenancy.connect_live_transaction_lease_database()
    assert tenancy.is_live_transaction_lease_database_connected()
    lease_client.connect.assert_awaited_once()
    assert await tenancy.check_live_transaction_lease_database()
    await tenancy.disconnect_live_transaction_lease_database()
    assert not tenancy.is_live_transaction_lease_database_connected()


@pytest.mark.asyncio
async def test_live_request_transactions_leave_pool_headroom(mocker):
    active = 0
    peak = 0
    entered = asyncio.Event()
    release = asyncio.Event()

    @asynccontextmanager
    async def transaction(**_kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        if active == tenancy.LIVE_REQUEST_TRANSACTION_LIMIT:
            entered.set()
        try:
            await release.wait()
            yield MagicMock()
        finally:
            active -= 1

    fake_prisma = MagicMock()
    fake_prisma.tx.side_effect = transaction
    mocker.patch.object(tenancy, "prisma", fake_prisma)

    async def hold_transaction():
        async with tenancy.live_request_transaction():
            pass

    tasks = [
        asyncio.create_task(hold_transaction())
        for _ in range(tenancy.LIVE_REQUEST_TRANSACTION_LIMIT + 3)
    ]
    await asyncio.wait_for(entered.wait(), timeout=10)
    await asyncio.sleep(0)
    assert active == tenancy.LIVE_REQUEST_TRANSACTION_LIMIT
    release.set()
    await asyncio.gather(*tasks)
    assert peak == tenancy.LIVE_REQUEST_TRANSACTION_LIMIT


@pytest.mark.asyncio
async def test_live_request_transaction_reuses_the_current_task_transaction(mocker):
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock(return_value=MagicMock())
    transaction.__aexit__ = AsyncMock(return_value=False)
    fake_prisma = MagicMock()
    fake_prisma.tx.return_value = transaction
    mocker.patch.object(tenancy, "prisma", fake_prisma)

    async with tenancy.live_request_transaction() as outer:
        async with tenancy.live_request_transaction() as inner:
            assert inner is outer

    fake_prisma.tx.assert_called_once_with(
        timeout=tenancy.LIVE_ACTION_TRANSACTION_TIMEOUT
    )


@pytest.mark.asyncio
async def test_live_request_transaction_does_not_leak_into_child_tasks(mocker):
    transactions = [MagicMock(), MagicMock()]

    @asynccontextmanager
    async def transaction(**_kwargs):
        yield transactions.pop(0)

    fake_prisma = MagicMock()
    fake_prisma.tx.side_effect = transaction
    mocker.patch.object(tenancy, "prisma", fake_prisma)

    async with tenancy.live_request_transaction() as outer:

        async def use_child_transaction():
            async with tenancy.live_request_transaction() as inner:
                return inner

        inner = await asyncio.create_task(use_child_transaction())

    assert inner is not outer
    assert fake_prisma.tx.call_count == 2


@pytest.mark.asyncio
async def test_live_request_transaction_does_not_reuse_another_client():
    first_transaction = MagicMock()
    first_transaction.__aenter__ = AsyncMock(return_value=MagicMock())
    first_transaction.__aexit__ = AsyncMock(return_value=False)
    first_client = MagicMock()
    first_client.tx.return_value = first_transaction
    second_transaction = MagicMock()
    second_transaction.__aenter__ = AsyncMock(return_value=MagicMock())
    second_transaction.__aexit__ = AsyncMock(return_value=False)
    second_client = MagicMock()
    second_client.tx.return_value = second_transaction

    async with tenancy.live_request_transaction(first_client) as outer:
        async with tenancy.live_request_transaction(second_client) as inner:
            assert inner is not outer

    first_client.tx.assert_called_once()
    second_client.tx.assert_called_once()


def test_no_org_degrades_to_personal_ownership():
    assert visibility_filter("u1", None, []) == {"userId": "u1"}


def test_org_filter_covers_own_orghome_and_team_rows():
    where = visibility_filter("u1", "org-1", ["team-a", "team-b"])
    assert where == {
        "OR": [
            {
                "userId": "u1",
                "organizationId": None,
            },
            {"organizationId": "org-1", "teamId": None},
            {"organizationId": "org-1", "teamId": {"in": ["team-a", "team-b"]}},
        ]
    }


def test_org_filter_without_teams_omits_team_clause():
    where = visibility_filter("u1", "org-1", [])
    assert where == {
        "OR": [
            {
                "userId": "u1",
                "organizationId": None,
            },
            {"organizationId": "org-1", "teamId": None},
        ]
    }


def test_team_restriction_is_exact_even_for_owned_rows():
    assert visibility_filter(
        "u1",
        "org-1",
        ["team-a", "team-b"],
        team_id_restriction="team-a",
    ) == {
        "organizationId": "org-1",
        "teamId": "team-a",
    }


def test_custom_field_names():
    where = visibility_filter(
        "u1",
        "org-1",
        [],
        user_field="owningUserId",
        org_field="owningOrgId",
    )
    assert where["OR"][0] == {
        "owningUserId": "u1",
        "owningOrgId": None,
    }


def _org_member(*, owner=False, admin=False, billing=False) -> SimpleNamespace:
    return SimpleNamespace(isOwner=owner, isAdmin=admin, isBillingManager=billing)


def _team_member(team_id: str, *, admin=False, billing=False) -> SimpleNamespace:
    return SimpleNamespace(teamId=team_id, isAdmin=admin, isBillingManager=billing)


@pytest.fixture
def members(mocker):
    """The org and team membership rows the lookups below read."""
    client = MagicMock()
    client.orgmember.find_first = AsyncMock(return_value=_org_member())
    client.teammember.find_many = AsyncMock(return_value=[])
    client.teammember.find_first = AsyncMock(return_value=None)
    mocker.patch.object(tenancy, "prisma", client)
    return client


@pytest.mark.asyncio
async def test_get_user_team_ids_filters_active_org_memberships(mocker):
    m1 = MagicMock()
    m1.teamId = "team-a"
    m1.isAdmin = False
    m1.isBillingManager = False
    billing_only = MagicMock()
    billing_only.teamId = "team-billing"
    billing_only.isAdmin = False
    billing_only.isBillingManager = True
    admin_and_billing = MagicMock()
    admin_and_billing.teamId = "team-admin"
    admin_and_billing.isAdmin = True
    admin_and_billing.isBillingManager = True
    mock_prisma = MagicMock()
    mock_prisma.orgmember.find_first = AsyncMock(
        return_value=MagicMock(isOwner=False, isAdmin=False, isBillingManager=False)
    )
    mock_prisma.teammember.find_many = AsyncMock(
        return_value=[m1, billing_only, admin_and_billing]
    )
    mocker.patch.object(tenancy, "prisma", mock_prisma)

    result = await get_user_team_ids("u1", "org-1")

    assert result == ["team-a", "team-admin"]
    where = mock_prisma.teammember.find_many.call_args.kwargs["where"]
    assert where["userId"] == "u1"
    assert where["status"] == "ACTIVE"
    assert where["Team"] == {"is": {"orgId": "org-1", "archivedAt": None}}


@pytest.mark.asyncio
async def test_get_user_team_ids_excludes_org_billing_only_member(mocker):
    mock_prisma = MagicMock()
    mock_prisma.orgmember.find_first = AsyncMock(
        return_value=MagicMock(isOwner=False, isAdmin=False, isBillingManager=True)
    )
    mock_prisma.teammember.find_many = AsyncMock()
    mocker.patch.object(tenancy, "prisma", mock_prisma)

    assert await get_user_team_ids("u1", "org-1") == []
    mock_prisma.teammember.find_many.assert_not_awaited()


@pytest.mark.asyncio
async def test_live_resource_lease_holds_and_releases_barrier(mocker):
    entered = False
    exited = False
    request_limited = True

    @asynccontextmanager
    async def barrier(*_args, **kwargs):
        nonlocal entered, exited, request_limited
        entered = True
        request_limited = kwargs["request_limited"]
        try:
            yield True
        finally:
            exited = True

    mocker.patch.object(tenancy, "live_resource_access_barrier", barrier)

    lease_id = await tenancy.acquire_live_resource_lease(
        "user-1", "org-1", "team-1", "execute"
    )

    assert lease_id is not None
    assert entered is True
    assert request_limited is False
    assert exited is False
    assert await tenancy.release_live_resource_lease(lease_id) is True
    assert exited is True
    assert await tenancy.release_live_resource_lease(lease_id) is False


@pytest.mark.asyncio
async def test_resource_acquisition_timeout_cleans_an_unclaimed_holder(mocker):
    entered = asyncio.Event()

    @asynccontextmanager
    async def blocked(*_args, **_kwargs):
        entered.set()
        await asyncio.Event().wait()
        yield True

    mocker.patch.object(tenancy, "live_resource_access_barrier", blocked)
    mocker.patch.object(tenancy, "LIVE_LEASE_ACQUISITION_TIMEOUT_SECONDS", 0.01)
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(
            tenancy.acquire_live_resource_lease("owner", "org", None, "execute"), 5
        )
    assert entered.is_set()
    assert not tenancy._live_transaction_lease_holders
    assert not tenancy._live_resource_leases
    assert tenancy._get_live_transaction_lease_slots("resource")._value == 3


@pytest.mark.asyncio
async def test_abandoned_resource_holder_expires_and_restores_capacity(mocker):
    @asynccontextmanager
    async def allowed(*_args, **_kwargs):
        yield True

    mocker.patch.object(tenancy, "live_resource_access_barrier", allowed)
    mocker.patch.object(tenancy, "LIVE_RESOURCE_LEASE_TIMEOUT_SECONDS", 0.01)
    lease = await tenancy.acquire_live_resource_lease("owner", "org", None, "execute")
    assert lease is not None
    holder = tenancy._live_resource_leases[lease][1]
    await asyncio.wait_for(holder, 5)
    assert not await tenancy.is_live_resource_lease_active(lease)
    assert not tenancy._live_transaction_lease_holders
    assert tenancy._get_live_transaction_lease_slots("resource")._value == 3


@pytest.mark.asyncio
async def test_nested_persistent_lease_classes_make_progress_without_deadlock(mocker):
    active = {"resource": 0, "attachment": 0, "delivery": 0}
    peak = {"resource": 0, "attachment": 0, "delivery": 0}
    first_wave_ready = asyncio.Event()
    release_first_wave = asyncio.Event()
    innermost = 0

    @asynccontextmanager
    async def resource_barrier(*_args, **kwargs):
        assert kwargs["client"] is tenancy.live_transaction_lease_prisma
        active["resource"] += 1
        peak["resource"] = max(peak["resource"], active["resource"])
        try:
            yield True
        finally:
            active["resource"] -= 1

    @asynccontextmanager
    async def attachment_barrier(_graph_ids, *, client=None):
        assert client is tenancy.live_transaction_lease_prisma
        active["attachment"] += 1
        peak["attachment"] = max(peak["attachment"], active["attachment"])
        try:
            yield
        finally:
            active["attachment"] -= 1

    @asynccontextmanager
    async def delivery_barrier(_condition_ids, *, client=None):
        nonlocal innermost
        assert client is tenancy.live_transaction_lease_prisma
        active["delivery"] += 1
        peak["delivery"] = max(peak["delivery"], active["delivery"])
        innermost += 1
        if innermost == tenancy.LIVE_TRANSACTION_LEASE_CLASS_LIMIT:
            first_wave_ready.set()
        try:
            yield
        finally:
            active["delivery"] -= 1

    mocker.patch.object(tenancy, "live_resource_access_barrier", resource_barrier)
    mocker.patch.object(tenancy, "agent_graph_attachment_barriers", attachment_barrier)
    mocker.patch.object(tenancy, "alert_condition_delivery_barriers", delivery_barrier)

    async def run_nested_chain(index: int):
        resource_id = await tenancy.acquire_live_resource_lease(
            f"user-{index}", "org-1", None, "execute"
        )
        assert resource_id is not None
        attachment_id = await tenancy.acquire_agent_graph_attachment_lease(
            [f"graph-{index}"]
        )
        delivery_id = await tenancy.acquire_alert_condition_delivery_lease(
            [f"condition-{index}"]
        )
        if index < tenancy.LIVE_TRANSACTION_LEASE_CLASS_LIMIT:
            await release_first_wave.wait()
        assert await tenancy.release_alert_condition_delivery_lease(delivery_id)
        assert await tenancy.release_agent_graph_attachment_lease(attachment_id)
        assert await tenancy.release_live_resource_lease(resource_id)

    tasks = [
        asyncio.create_task(run_nested_chain(index))
        for index in range(tenancy.LIVE_TRANSACTION_LEASE_CLASS_LIMIT + 1)
    ]
    await asyncio.wait_for(first_wave_ready.wait(), timeout=10)
    await asyncio.sleep(0)
    assert active == {
        "resource": tenancy.LIVE_TRANSACTION_LEASE_CLASS_LIMIT,
        "attachment": tenancy.LIVE_TRANSACTION_LEASE_CLASS_LIMIT,
        "delivery": tenancy.LIVE_TRANSACTION_LEASE_CLASS_LIMIT,
    }
    assert not any(task.done() for task in tasks)

    release_first_wave.set()
    await asyncio.wait_for(asyncio.gather(*tasks), timeout=10)
    assert peak == {
        "resource": tenancy.LIVE_TRANSACTION_LEASE_CLASS_LIMIT,
        "attachment": tenancy.LIVE_TRANSACTION_LEASE_CLASS_LIMIT,
        "delivery": tenancy.LIVE_TRANSACTION_LEASE_CLASS_LIMIT,
    }
    assert active == {"resource": 0, "attachment": 0, "delivery": 0}


@pytest.mark.asyncio
async def test_personal_resource_lease_bypasses_persistent_transaction_pool(mocker):
    @asynccontextmanager
    async def barrier(*_args, **kwargs):
        assert kwargs.get("client") is None
        yield True

    slot = mocker.patch.object(tenancy, "_live_transaction_lease_slot")
    mocker.patch.object(tenancy, "live_resource_access_barrier", barrier)

    lease_id = await tenancy.acquire_live_resource_lease(
        "user-1", None, None, "execute"
    )

    assert lease_id is not None
    slot.assert_not_called()
    assert await tenancy.release_live_resource_lease(lease_id)


@pytest.mark.asyncio
async def test_cancel_queued_resource_lease_acquisition_restores_holder_registry(
    mocker,
):
    @asynccontextmanager
    async def barrier(*_args, **_kwargs):
        yield True

    mocker.patch.object(tenancy, "live_resource_access_barrier", barrier)
    active_ids = await asyncio.gather(
        *(
            tenancy.acquire_live_resource_lease(
                f"active-user-{index}", "org-1", None, "execute"
            )
            for index in range(tenancy.LIVE_TRANSACTION_LEASE_CLASS_LIMIT)
        )
    )
    queued = asyncio.create_task(
        tenancy.acquire_live_resource_lease("queued-user", "org-1", None, "execute")
    )
    await asyncio.sleep(0)
    queued.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(queued, timeout=10)

    assert len(tenancy._live_transaction_lease_holders) == len(active_ids)
    for lease_id in active_ids:
        assert lease_id is not None
        assert await tenancy.release_live_resource_lease(lease_id)
    assert not tenancy._live_transaction_lease_holders


@pytest.mark.asyncio
async def test_shutdown_cancels_active_and_queued_lease_holders(mocker):
    @asynccontextmanager
    async def barrier(*_args, **_kwargs):
        yield True

    mocker.patch.object(tenancy, "live_resource_access_barrier", barrier)
    active_ids = await asyncio.gather(
        *(
            tenancy.acquire_live_resource_lease(
                f"active-user-{index}", "org-1", None, "execute"
            )
            for index in range(tenancy.LIVE_TRANSACTION_LEASE_CLASS_LIMIT)
        )
    )
    queued = asyncio.create_task(
        tenancy.acquire_live_resource_lease("queued-user", "org-1", None, "execute")
    )
    for _ in range(10):
        if len(tenancy._live_transaction_lease_holders) == len(active_ids) + 1:
            break
        await asyncio.sleep(0)
    assert len(tenancy._live_transaction_lease_holders) == len(active_ids) + 1

    await tenancy.release_all_live_transaction_leases()

    for _ in range(10):
        if queued.done():
            break
        await asyncio.sleep(0)
    assert queued.done()
    with pytest.raises(asyncio.CancelledError):
        await queued
    assert not tenancy._live_transaction_lease_holders
    assert all(lease_id is not None for lease_id in active_ids)
    active_statuses = await asyncio.gather(
        *(
            tenancy.is_live_resource_lease_active(lease_id)
            for lease_id in active_ids
            if lease_id is not None
        )
    )
    assert not any(active_statuses)


@pytest.mark.asyncio
async def test_graph_attachment_lease_holds_sorted_scope_until_release(mocker):
    entered_ids: list[str] | None = None
    exited = False

    @asynccontextmanager
    async def barrier(graph_ids, *, client=None):
        nonlocal entered_ids, exited
        assert client is tenancy.live_transaction_lease_prisma
        entered_ids = sorted(graph_ids)
        try:
            yield
        finally:
            exited = True

    mocker.patch.object(tenancy, "agent_graph_attachment_barriers", barrier)

    lease_id = await tenancy.acquire_agent_graph_attachment_lease(
        ["graph-b", "graph-a", "graph-b"]
    )

    assert entered_ids == ["graph-a", "graph-b"]
    assert exited is False
    assert await tenancy.release_agent_graph_attachment_lease(lease_id) is True
    assert exited is True


@pytest.mark.asyncio
@pytest.mark.parametrize("access", ["view", "create", "execute"])
async def test_billing_only_team_has_no_live_resource_access(mocker, access):
    org_member = MagicMock(isOwner=False, isAdmin=False, isBillingManager=False)
    team_member = MagicMock(isAdmin=False, isBillingManager=True)
    mock_prisma = MagicMock()
    mock_prisma.orgmember.find_first = AsyncMock(return_value=org_member)
    mock_prisma.teammember.find_first = AsyncMock(return_value=team_member)
    mocker.patch.object(tenancy, "prisma", mock_prisma)

    assert await has_live_resource_access("u1", "org-1", "team-1", access) is False


@pytest.mark.asyncio
@pytest.mark.parametrize("access", ["view", "create", "execute"])
async def test_plain_team_member_has_live_resource_access(mocker, access):
    org_member = MagicMock(isOwner=False, isAdmin=False, isBillingManager=False)
    team_member = MagicMock(isAdmin=False, isBillingManager=False)
    mock_prisma = MagicMock()
    mock_prisma.orgmember.find_first = AsyncMock(return_value=org_member)
    mock_prisma.teammember.find_first = AsyncMock(return_value=team_member)
    mocker.patch.object(tenancy, "prisma", mock_prisma)

    assert await has_live_resource_access("u1", "org-1", "team-1", access) is True


@pytest.mark.asyncio
@pytest.mark.parametrize("access", ["view", "create", "execute"])
async def test_org_billing_only_has_no_team_resource_access(mocker, access):
    org_member = MagicMock(isOwner=False, isAdmin=False, isBillingManager=True)
    team_member = MagicMock(isAdmin=False, isBillingManager=False)
    mock_prisma = MagicMock()
    mock_prisma.orgmember.find_first = AsyncMock(return_value=org_member)
    mock_prisma.teammember.find_first = AsyncMock(return_value=team_member)
    mocker.patch.object(tenancy, "prisma", mock_prisma)

    assert await has_live_resource_access("u1", "org-1", "team-1", access) is False


@pytest.mark.asyncio
async def test_graph_barrier_rechecks_graph_after_lock(mocker):
    tx = MagicMock()
    tx.execute_raw = AsyncMock()
    tx.orgmember.find_first = AsyncMock(
        return_value=MagicMock(isOwner=False, isAdmin=False, isBillingManager=False)
    )
    tx.teammember.find_first = AsyncMock(
        return_value=MagicMock(isAdmin=False, isBillingManager=False)
    )
    tx.agentgraph.find_first = AsyncMock(return_value=None)
    tx_context = MagicMock()
    tx_context.__aenter__ = AsyncMock(return_value=tx)
    tx_context.__aexit__ = AsyncMock(return_value=False)
    mock_prisma = MagicMock()
    mock_prisma.tx.return_value = tx_context
    mocker.patch.object(tenancy, "prisma", mock_prisma)
    async with live_agent_graph_access_barrier(
        "u1", "org-1", "team-1", "create", "graph-1", 2
    ) as allowed:
        assert allowed is False

    tx.execute_raw.assert_has_awaits(
        [
            call(
                "SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
                "tenancy:org-user:org-1:u1",
            ),
            call(
                "SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
                "tenancy:org:org-1",
            ),
            call(
                "SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
                "tenancy:team:team-1",
            ),
            call(
                "SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
                "agent-graph:graph-1",
            ),
        ]
    )
    tx.agentgraph.find_first.assert_awaited_once_with(
        where={
            "id": "graph-1",
            "version": 2,
            "organizationId": "org-1",
            "teamId": "team-1",
        }
    )


@pytest.mark.asyncio
async def test_get_user_team_ids_checks_active_org_and_team(members):
    members.teammember.find_many.return_value = [_team_member("team-a")]

    result = await get_user_team_ids("u1", "org-1")

    assert result == ["team-a"]
    where = members.teammember.find_many.call_args.kwargs["where"]
    assert where["userId"] == "u1"
    assert where["status"] == "ACTIVE"
    assert where["Team"] == {"is": {"orgId": "org-1", "archivedAt": None}}
    assert members.orgmember.find_first.call_args.kwargs["where"] == {
        "userId": "u1",
        "orgId": "org-1",
        "status": "ACTIVE",
        "Org": {"is": {"deletedAt": None}},
    }


@pytest.mark.asyncio
async def test_get_user_team_ids_leaves_out_teams_where_the_user_only_manages_billing(
    members,
):
    members.teammember.find_many.return_value = [
        _team_member("member-of"),
        _team_member("billing-only", billing=True),
        _team_member("admin-and-billing", admin=True, billing=True),
        _team_member("admin-of", admin=True),
    ]

    assert await get_user_team_ids("u1", "org-1") == [
        "member-of",
        "admin-and-billing",
        "admin-of",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "org_member, teams",
    [
        (None, []),
        (_org_member(billing=True), []),
        (_org_member(owner=True, billing=True), ["team-a"]),
        (_org_member(admin=True, billing=True), ["team-a"]),
        (_org_member(), ["team-a"]),
    ],
    ids=[
        "not-an-active-member",
        "org-billing-manager",
        "owner-and-billing-manager",
        "admin-and-billing-manager",
        "plain-member",
    ],
)
async def test_get_user_team_ids_follows_the_org_role(members, org_member, teams):
    """An org billing manager sees no team's rows, whatever teams they're on."""
    members.orgmember.find_first.return_value = org_member
    members.teammember.find_many.return_value = [_team_member("team-a")]

    assert await get_user_team_ids("u1", "org-1") == teams


async def _require(team_id: str | None = "team-1", org_id: str | None = "org-1"):
    await require_role_where_resource_lives(
        "u1", org_id, team_id, OrgAction.SHARE_RESOURCES, TeamAction.VIEW_EXECUTIONS
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "org_member, team_member",
    [
        (_org_member(), _team_member("team-1")),
        (_org_member(), _team_member("team-1", admin=True, billing=True)),
        (_org_member(owner=True, billing=True), _team_member("team-1")),
        (_org_member(), None),
        (None, None),
    ],
    ids=[
        "team-member",
        "team-admin-and-billing",
        "owner-and-billing",
        "no-longer-on-the-team",
        "no-longer-in-the-org",
    ],
)
async def test_a_role_that_holds_the_action_or_no_membership_is_not_refused(
    members, org_member, team_member
):
    """Without a membership there the route's ownership checks decide, as before."""
    members.orgmember.find_first.return_value = org_member
    members.teammember.find_first.return_value = team_member

    await _require()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "org_member, team_member, refused_in",
    [
        (_org_member(billing=True), None, "organization"),
        (_org_member(billing=True), _team_member("team-1"), "organization"),
        (_org_member(), _team_member("team-1", billing=True), "workspace"),
        (_org_member(owner=True), _team_member("team-1", billing=True), "workspace"),
    ],
    ids=[
        "org-billing-manager",
        "org-billing-manager-on-the-team",
        "team-billing-manager",
        "owner-who-only-manages-the-teams-billing",
    ],
)
async def test_a_billing_manager_role_where_the_resource_lives_is_refused(
    members, org_member, team_member, refused_in
):
    members.orgmember.find_first.return_value = org_member
    members.teammember.find_first.return_value = team_member

    with pytest.raises(NotAuthorizedError, match=refused_in):
        await _require()


@pytest.mark.asyncio
async def test_the_team_lookup_is_confined_to_the_resources_org(members):
    await _require()

    assert members.teammember.find_first.call_args.kwargs["where"] == {
        "userId": "u1",
        "teamId": "team-1",
        "status": "ACTIVE",
        "Team": {"is": {"orgId": "org-1"}},
    }


@pytest.mark.asyncio
async def test_an_untagged_resource_needs_no_lookup(members):
    await _require(team_id=None, org_id=None)

    members.orgmember.find_first.assert_not_awaited()
    members.teammember.find_first.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_org_home_resource_checks_only_the_org_role(members):
    members.orgmember.find_first.return_value = _org_member(billing=True)

    with pytest.raises(NotAuthorizedError, match="organization"):
        await _require(team_id=None)
    members.teammember.find_first.assert_not_awaited()


TEAM_REFUSAL = BILLING_ONLY_TEAM_ROLE.format(team_id="team-1")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "org_member, team_member, team_id, refusal",
    [
        (_org_member(billing=True), None, None, BILLING_ONLY_ORG_ROLE),
        (
            _org_member(billing=True),
            _team_member("team-1"),
            "team-1",
            BILLING_ONLY_ORG_ROLE,
        ),
        (_org_member(), _team_member("team-1", billing=True), "team-1", TEAM_REFUSAL),
        (
            _org_member(owner=True),
            _team_member("team-1", billing=True),
            "team-1",
            TEAM_REFUSAL,
        ),
    ],
    ids=[
        "org-billing-manager-in-org-home",
        "org-billing-manager-on-the-team",
        "team-billing-manager",
        "owner-who-only-manages-the-teams-billing",
    ],
)
async def test_a_role_that_covers_only_billing_is_refused_the_resources(
    members, org_member, team_member, team_id, refusal
):
    members.orgmember.find_first.return_value = org_member
    members.teammember.find_first.return_value = team_member

    assert await resource_role_refusal("u1", "org-1", team_id) == refusal


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "org_member, team_member",
    [
        (_org_member(), _team_member("team-1")),
        (_org_member(owner=True, billing=True), _team_member("team-1")),
        (_org_member(admin=True, billing=True), _team_member("team-1")),
        (_org_member(), _team_member("team-1", admin=True, billing=True)),
        (_org_member(), None),
        (None, None),
    ],
    ids=[
        "plain-member",
        "owner-and-billing",
        "admin-and-billing",
        "team-admin-and-billing",
        "not-on-the-team",
        "not-in-the-org",
    ],
)
async def test_a_role_that_covers_workflows_or_no_membership_is_not_refused(
    members, org_member, team_member
):
    """Membership itself is checked where the org and team are resolved."""
    members.orgmember.find_first.return_value = org_member
    members.teammember.find_first.return_value = team_member

    assert await resource_role_refusal("u1", "org-1", "team-1") is None


@pytest.mark.asyncio
async def test_the_role_comes_from_active_memberships_within_the_org(members):
    await resource_role_refusal("u1", "org-1", "team-1")

    assert members.orgmember.find_first.call_args.kwargs["where"] == {
        "userId": "u1",
        "orgId": "org-1",
        "status": "ACTIVE",
    }
    assert members.teammember.find_first.call_args.kwargs["where"] == {
        "userId": "u1",
        "teamId": "team-1",
        "status": "ACTIVE",
        "Team": {"is": {"orgId": "org-1", "archivedAt": None}},
    }


@pytest.mark.asyncio
async def test_org_home_reads_no_team_membership(members):
    assert await resource_role_refusal("u1", "org-1", None) is None

    members.teammember.find_first.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "personal, writable", [(True, {"org-1", None}), (False, {"org-1"})]
)
async def test_untagged_rows_are_writable_only_from_the_personal_org(
    mocker, personal: bool, writable: set
):
    """They predate org tagging, and the backfill gives them the personal org."""
    mock_prisma = MagicMock()
    mock_prisma.orgmember.find_first = AsyncMock(
        return_value=MagicMock() if personal else None
    )
    mocker.patch.object(tenancy, "prisma", mock_prisma)

    assert await writable_organization_ids("u1", "org-1") == writable
    where = mock_prisma.orgmember.find_first.call_args.kwargs["where"]
    assert (where["userId"], where["orgId"]) == ("u1", "org-1")
    assert where["Org"] == {"isPersonal": True, "deletedAt": None}


@pytest.mark.asyncio
@pytest.mark.parametrize("owns_it", [True, False])
async def test_own_personal_org_is_a_live_personal_org_the_caller_owns(
    mocker, owns_it: bool
):
    mock_prisma = MagicMock()
    mock_prisma.orgmember.find_first = AsyncMock(
        return_value=MagicMock() if owns_it else None
    )
    mocker.patch.object(tenancy, "prisma", mock_prisma)

    assert await is_own_personal_org("u1", "org-1") is owns_it
    mock_prisma.orgmember.find_first.assert_awaited_once_with(
        where={
            "userId": "u1",
            "orgId": "org-1",
            "isOwner": True,
            "Org": {"isPersonal": True, "deletedAt": None},
        }
    )


def test_organization_filter_matches_untagged_rows_only_when_asked():
    assert organization_filter({"org-1"}) == {
        "OR": [{"organizationId": {"in": ["org-1"]}}]
    }
    assert organization_filter({"org-1", None}) == {
        "OR": [{"organizationId": {"in": ["org-1"]}}, {"organizationId": None}]
    }
