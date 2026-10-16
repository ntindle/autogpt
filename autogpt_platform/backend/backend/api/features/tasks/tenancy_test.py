from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from backend.api.features.tasks import db, routes
from backend.api.features.tasks.models import TaskCreate
from backend.util.exceptions import NotFoundError


@pytest.mark.asyncio
@pytest.mark.parametrize("found,allowed", [(False, True), (True, False), (True, True)])
async def test_task_chat_scope_requires_ownership_and_live_access(found, allowed):
    session = SimpleNamespace(organization_id="saved-org", team_id="saved-team")
    with (
        patch.object(
            routes,
            "get_chat_session_metadata",
            AsyncMock(return_value=session if found else None),
        ) as lookup,
        patch.object(
            routes, "has_live_resource_access", AsyncMock(return_value=allowed)
        ) as access,
    ):
        if found and allowed:
            scope = await routes.get_task_session_scope("chat-1", "owner-1")
            assert (scope.organization_id, scope.team_id) == ("saved-org", "saved-team")
        else:
            with pytest.raises(HTTPException) as exc:
                await routes.get_task_session_scope("chat-1", "owner-1")
            assert exc.value.status_code == 404
        lookup.assert_awaited_once_with("chat-1", "owner-1")
        if found:
            access.assert_awaited_once_with(
                "owner-1", "saved-org", "saved-team", "view"
            )
        else:
            access.assert_not_awaited()


@pytest.mark.asyncio
async def test_child_tasks_keep_the_parent_team(owner):
    parent = await db.create_workspace_task(
        owner, TaskCreate(title="Outcome"), "org-a", team_id="team-a"
    )
    with pytest.raises(NotFoundError):
        await db.create_workspace_task(
            owner,
            TaskCreate(title="Step", parent_id=parent.id),
            "org-b",
            team_id="team-b",
        )
    child = await db.create_workspace_task(
        owner, TaskCreate(title="Step", parent_id=parent.id), "org-a", team_id="team-b"
    )
    persisted = next(
        task
        for task in await db.list_workspace_tasks(owner, organization_id="org-a")
        if task.id == child.id
    )
    assert (persisted.organization_id, persisted.team_id) == ("org-a", "team-a")
