from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.notifications.review_alerts import sync_awaiting_review


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("metadata_org", "metadata_team", "expected_name"),
    [
        ("org-1", "team-1", "Named Agent"),
        ("org-other", "team-other", "Agent graph-12"),
    ],
)
async def test_review_alert_uses_graph_name_only_for_matching_scope(
    mocker, metadata_org, metadata_team, expected_name
):
    query = AsyncMock()
    query.find_many.return_value = [
        SimpleNamespace(
            createdAt=datetime(2026, 8, 27, 12, 30, tzinfo=timezone.utc),
            organizationId="org-1",
            teamId="team-1",
        )
    ]
    mocker.patch(
        "backend.notifications.review_alerts.PendingHumanReview.prisma",
        autospec=True,
        return_value=query,
    )
    mocker.patch(
        "backend.notifications.review_alerts.get_graph_metadata",
        new=AsyncMock(
            return_value=SimpleNamespace(
                name="Named Agent",
                organization_id=metadata_org,
                team_id=metadata_team,
            )
        ),
    )
    raise_alert = mocker.patch(
        "backend.notifications.review_alerts.alerts_db.raise_alert_condition",
        new_callable=AsyncMock,
    )

    await sync_awaiting_review("user-1", "graph-123456", "exec-1")

    raised = raise_alert.await_args.kwargs
    assert raised["data"]["agent"] == expected_name
    assert raised["organization_id"] == "org-1"
    assert raised["team_id"] == "team-1"


from unittest.mock import MagicMock

import pytest

from backend.notifications import review_alerts


@pytest.fixture
def alerts(mocker):
    db = MagicMock(
        resolve_alert_condition=AsyncMock(), raise_alert_condition=AsyncMock()
    )
    mocker.patch.object(review_alerts, "alerts_db", db)
    return db


def _waiting(mocker, rows):
    find_many = AsyncMock(return_value=rows)
    mocker.patch.object(
        review_alerts.PendingHumanReview,
        "prisma",
        return_value=MagicMock(find_many=find_many),
    )
    return find_many


@pytest.mark.asyncio
async def test_a_chat_alert_counts_old_shape_rows_and_clears_the_old_key(
    mocker, alerts
):
    find_many = _waiting(mocker, [])

    await review_alerts.sync_awaiting_review("u1", chat_session_id="s1")

    where = find_many.await_args.kwargs["where"]
    assert {"chatSessionId": "s1"} in where["OR"]
    assert {"graphExecId": "copilot-session-s1"} in where["OR"]
    resolved = [c.args[1] for c in alerts.resolve_alert_condition.await_args_list]
    assert resolved == ["awaiting_review:copilot-session-s1", "awaiting_review:chat:s1"]


@pytest.mark.asyncio
async def test_a_waiting_chat_review_raises_a_chat_alert(mocker, alerts):
    _waiting(mocker, [MagicMock(createdAt=datetime(2026, 9, 24, tzinfo=timezone.utc))])

    await review_alerts.sync_awaiting_review("u1", chat_session_id="s1")

    kwargs = alerts.raise_alert_condition.await_args.kwargs
    assert kwargs["cause_key"] == "awaiting_review:chat:s1"
    assert kwargs["data"]["cta_path"] == "/copilot?sessionId=s1"
