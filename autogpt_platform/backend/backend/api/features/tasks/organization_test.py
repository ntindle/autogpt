import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio

from backend.api.features.tasks import db as tasks
from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskCommand,
    TaskCreate,
    TaskSchedule,
)
from backend.api.features.tasks.planning_inputs import load_planning_environment
from backend.api.features.tasks.repository import _load_for_session
from backend.api.features.tasks.schedules import (
    list_task_schedules,
    set_schedule_paused,
)
from backend.data.db import prisma
from backend.executor.scheduler import CopilotTurnJobInfo
from backend.util.exceptions import NotFoundError

pytestmark = pytest.mark.skipif(
    not os.getenv("TASKS_TEST_DATABASE"), reason="Requires isolated task database"
)


@pytest_asyncio.fixture
async def organizations(owner):
    orgs = []
    for name in ("Personal", "Denton", "Reviewer"):
        orgs.append(
            await prisma.organization.create(
                data={
                    "name": name,
                    "slug": str(uuid4()),
                    "isPersonal": name == "Personal",
                    "bootstrapUserId": owner if name == "Personal" else None,
                    "Members": {"create": {"userId": owner, "isOwner": True}},
                }
            )
        )
    yield [org.id for org in orgs]
    for org in orgs:
        await prisma.organization.delete(where={"id": org.id})


@pytest.mark.asyncio
async def test_list_commands_parents_and_idempotency_stay_in_org(owner, organizations):
    personal, denton, reviewer = organizations
    legacy = await tasks.create_workspace_task(
        owner, TaskCreate(title="Existing personal task")
    )
    a = await tasks.create_workspace_task(
        owner, TaskCreate(title="Denton task"), denton
    )
    b = await tasks.create_workspace_task(
        owner, TaskCreate(title="Review task"), reviewer
    )
    assert [t.id for t in await tasks.list_workspace_tasks(owner, personal)] == [
        legacy.id
    ]
    assert [t.id for t in await tasks.list_workspace_tasks(owner, denton)] == [a.id]
    with pytest.raises(NotFoundError):
        await tasks.command_workspace_task(
            owner,
            a.id,
            TaskCommand(operation="complete", version=a.version),
            organization_id=reviewer,
        )
    with pytest.raises(NotFoundError):
        await tasks.create_workspace_task(
            owner, TaskCreate(id=a.id, title="Overwrite"), reviewer
        )
    with pytest.raises(NotFoundError):
        await tasks.create_workspace_task(
            owner, TaskCreate(title="Cross-org child", parent_id=a.id), reviewer
        )
    with pytest.raises(TaskConflict):
        await tasks.command_workspace_task(
            owner,
            b.id,
            TaskCommand(operation="edit", version=b.version, dependencies=[a.id]),
            organization_id=reviewer,
        )
    assert (await tasks.list_workspace_tasks(owner, denton))[0].title == "Denton task"


@pytest.mark.asyncio
async def test_planning_roster_and_source_chat_are_private_to_org(owner, organizations):
    _, denton, reviewer = organizations
    for org in (denton, reviewer):
        await prisma.expert.create(
            data={
                "ownerUserId": owner,
                "organizationId": org,
                "name": org,
                "role": "Specialist",
                "identity": "Private business context",
            }
        )
    session = await prisma.chatsession.create(
        data={"userId": owner, "organizationId": reviewer}
    )
    a = await tasks.create_workspace_task(
        owner, TaskCreate(title="Denton plan"), denton
    )
    environment = await load_planning_environment(
        prisma, owner, [a.model_copy(update={"source_session_id": session.id})], denton
    )
    assert [c.name for c in environment.candidates if c.kind == "expert"] == [denton]
    assert environment.conversations == {}
    with pytest.raises(TaskConflict):
        await tasks.create_workspace_task(
            owner, TaskCreate(title="Wrong chat"), denton, source_session_id=session.id
        )
    assert await _load_for_session(prisma, owner, session.id) == []


@pytest.mark.asyncio
async def test_delayed_dispatch_and_schedule_occurrence_keep_saved_org(
    owner, organizations
):
    _, denton, reviewer = organizations
    a = await tasks.create_workspace_task(
        owner, TaskCreate(title="Recurring work"), denton
    )
    a = await tasks.command_workspace_task(
        owner,
        a.id,
        TaskCommand(
            operation="assign",
            version=a.version,
            assignee=TaskAssignee(kind="auto", id="auto", name="Otto"),
        ),
        organization_id=denton,
    )
    with pytest.raises(NotFoundError):
        await tasks.claim_workspace_task_dispatch(owner, a.id, organization_id=reviewer)
    claimed = await tasks.claim_workspace_task_dispatch(
        owner, a.id, organization_id=denton
    )
    assert claimed and claimed.organization_id == denton
    await tasks.update_workspace_task_dispatch(
        owner, a.id, claimed.dispatch_id, "failed", organization_id=denton
    )
    a = (await tasks.list_workspace_tasks(owner, denton))[0]
    a = await tasks.configure_workspace_task_schedule(
        owner, a.id, a.version, TaskSchedule(cron="0 9 * * *"), organization_id=denton
    )
    assert a.schedule
    occurrence = await tasks.create_workspace_task_occurrence(
        owner, a.id, a.schedule.id, "2026-10-17T09:00:00Z", organization_id=denton
    )
    assert occurrence and occurrence.organization_id == denton
    assert await tasks.list_workspace_tasks(owner, reviewer) == []


@pytest.mark.asyncio
async def test_schedule_list_and_pause_cannot_reach_other_org(owner, organizations):
    _, denton, reviewer = organizations
    jobs = [
        CopilotTurnJobInfo(
            id=str(uuid4()),
            name=org,
            user_id=owner,
            message="Run",
            organization_id=org,
            cron="0 9 * * *",
            next_run_time="",
            timezone="UTC",
        )
        for org in (denton, reviewer)
    ]
    scheduler = AsyncMock()
    scheduler.get_execution_schedules.return_value = jobs
    with patch(
        "backend.api.features.tasks.schedules.get_scheduler_client",
        return_value=scheduler,
    ):
        assert [job.id for job in await list_task_schedules(owner, denton)] == [
            jobs[0].id
        ]
        with pytest.raises(NotFoundError):
            await set_schedule_paused(owner, jobs[1].id, True, organization_id=denton)
    scheduler.pause_schedule.assert_not_awaited()


@pytest.mark.asyncio
async def test_task_chat_uses_saved_org_connection_after_switch(
    owner, organizations, monkeypatch
):
    from backend.api.features.tasks import service
    from backend.copilot import transports
    from backend.copilot.transports_test import _codex_credentials
    from backend.data import user
    from backend.integrations.credential_scope import credential_scope

    _, denton, reviewer = organizations
    a, b = _codex_credentials(str(uuid4())), _codex_credentials(str(uuid4()))
    await user.set_user_credentials(owner, [a], denton)
    await user.set_user_credentials(owner, [b], reviewer)
    monkeypatch.setattr(
        transports, "has_codex_access_for_discovery", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(transports, "is_deployment_chat_available", lambda: False)
    monkeypatch.setattr(
        transports,
        "user_db",
        lambda: SimpleNamespace(
            get_user_default_chat_route=AsyncMock(return_value=("codex", a.id))
        ),
    )
    task = await tasks.create_workspace_task(
        owner, TaskCreate(title="Denton work"), denton
    )
    task = await tasks.bind_workspace_task_session(
        owner, task.id, organization_id=denton
    )
    monkeypatch.setattr(service, "get_chat_session", AsyncMock(return_value=None))
    create = AsyncMock(
        return_value=SimpleNamespace(session_id=task.session_id, user_id=owner)
    )
    monkeypatch.setattr(service, "create_chat_session", create)
    monkeypatch.setattr(service, "update_session_title", AsyncMock())
    with credential_scope(reviewer):
        await service.ensure_task_session(task)
    assert create.await_args.kwargs["organization_id"] == denton
    assert create.await_args.kwargs["llm_credential_id"] == a.id
