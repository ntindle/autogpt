import os
from unittest.mock import AsyncMock, patch

import pytest

from backend.api.features.tasks import db as task_db
from backend.api.features.tasks.decomposition import ProposedBreakdown
from backend.api.features.tasks.planning_refresh import (
    reconsider_unassigned_workspace_tasks,
)
from backend.api.features.tasks.recommendations import OwnerRecommendation
from backend.api.features.tasks.reconsideration_test import planned
from backend.data import db

pytestmark = pytest.mark.skipif(
    not os.getenv("TASKS_TEST_DATABASE"), reason="Requires isolated task database"
)


@pytest.mark.asyncio
async def test_background_refresh_publishes_both_suggestions_once_without_execution(
    owner,
):
    original = await planned(owner)
    expert = await db.prisma.expert.create(
        data={
            "ownerUserId": owner,
            "name": "Grid specialist",
            "role": "3D design",
            "identity": "Designs parametric organizers",
        }
    )
    owner_result = OwnerRecommendation.model_validate(
        {"choice": {"assignee_id": expert.id, "reason": "Fits the grid design"}}
    )
    breakdown_result = ProposedBreakdown.model_validate(
        {
            "steps": [
                {
                    "key": "layout",
                    "title": "Draft the grid layout",
                    "description": "Fit the selected kit contents",
                    "assignee_id": expert.id,
                    "reason": "Has parametric design skills",
                }
            ]
        }
    )
    with (
        patch(
            "backend.api.features.tasks.recommendations.planning_completion",
            AsyncMock(return_value=owner_result),
        ) as owner_model,
        patch(
            "backend.api.features.tasks.decomposition.planning_completion",
            AsyncMock(return_value=breakdown_result),
        ) as breakdown_model,
    ):
        await reconsider_unassigned_workspace_tasks(owner)
        await reconsider_unassigned_workspace_tasks(owner)
    owner_model.assert_awaited_once()
    breakdown_model.assert_awaited_once()
    tasks = await task_db.list_workspace_tasks(owner)
    assert len(tasks) == 1
    current = tasks[0]
    assert current.suggestion.id == expert.id
    assert current.breakdown.id != original.breakdown.id
    assert current.breakdown.state == "ready"
    assert current.breakdown.steps[0].suggestion.id == expert.id
    assert current.breakdown_refresh is None
    assert current.assignee is None and current.dispatch_id is None
    assert current.version == original.version
