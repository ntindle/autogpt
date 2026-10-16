from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.api.features.tasks.models import TaskAssignee
from backend.api.features.tasks.planning_model import planning_roster


@pytest.mark.parametrize("organization_id", [None, "saved-business-org"])
async def test_planning_roster_loads_expert_context_from_saved_org(organization_id):
    expert = SimpleNamespace(
        id="reviewer",
        role="Code review",
        bio="Business reviewer",
        skills=["review"],
        identity="Private review conventions",
    )
    candidate = TaskAssignee(kind="expert", id=expert.id, name="Reviewer")
    assignees = AsyncMock(return_value=[candidate])
    experts = SimpleNamespace(list_experts=AsyncMock(return_value=[expert]))
    with (
        patch("backend.api.features.tasks.planning_model.task_assignees", assignees),
        patch(
            "backend.api.features.tasks.planning_model.experts_db", return_value=experts
        ),
    ):
        candidates, roster = await planning_roster("owner", organization_id)
    assert candidates == [candidate]
    assert roster[0]["identity"] == "Private review conventions"
    assert roster[0]["role"] == "Code review"
    assignees.assert_awaited_once_with("owner", organization_id=organization_id)
    experts.list_experts.assert_awaited_once_with(
        "owner", with_metrics=False, organization_id=organization_id
    )
