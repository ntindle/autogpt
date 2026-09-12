import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from backend.api.features.tasks import db as task_db
from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskBreakdownRequest,
    TaskBreakdownStep,
    TaskCommand,
    TaskCreate,
    WorkspaceTask,
)
from backend.data import db

pytestmark = pytest.mark.skipif(
    not os.getenv("TASKS_TEST_DATABASE"), reason="Requires isolated task database"
)
AUTO = TaskAssignee(kind="auto", id="auto", name="AutoPilot")


async def planned(owner, **fields):
    task = await task_db.create_workspace_task(
        owner, TaskCreate(title="Prepare the kit", **fields)
    )
    suggestion = await task_db.begin_workspace_task_suggestion(owner, task.id)
    assert suggestion
    await task_db.finish_workspace_task_suggestion(
        owner, task.id, suggestion.suggestion_request_id, AUTO, []
    )
    preview = await task_db.begin_workspace_task_breakdown(
        owner,
        task.id,
        TaskBreakdownRequest(guidance="Keep the existing design", detail="milestones"),
    )
    assert preview.breakdown
    await task_db.finish_workspace_task_breakdown(
        owner,
        task.id,
        preview.breakdown.id,
        [TaskBreakdownStep(title="Choose parts", suggestion=AUTO)],
    )
    return next(
        item for item in await task_db.list_workspace_tasks(owner) if item.id == task.id
    )


@pytest.mark.asyncio
async def test_roster_changes_refresh_unassigned_suggestions_and_previews_once(owner):
    task = await planned(owner)
    assigned = await planned(owner)
    assigned = await task_db.command_workspace_task(
        owner,
        assigned.id,
        TaskCommand(
            operation="assign",
            version=assigned.version,
            assignee=TaskAssignee(kind="human", id=owner, name="Old name"),
        ),
    )
    await db.prisma.expert.create(
        data={
            "ownerUserId": owner,
            "name": "Drafting specialist",
            "role": "CAD",
            "identity": "Designs organizers",
            "skills": ["3D printing"],
        }
    )
    jobs = await task_db.reconsider_workspace_task_plans(owner)
    job = next(item for item in jobs if item.task.id == task.id)
    assert job.owner and job.breakdown
    assert job.task.version == task.version
    assert job.task.breakdown == task.breakdown
    assert job.task.breakdown_refresh.guidance == "Keep the existing design"
    assert job.task.breakdown_refresh.detail == "milestones"
    assert assigned.id not in {item.task.id for item in jobs}
    assert await task_db.reconsider_workspace_task_plans(owner) == []


@pytest.mark.asyncio
async def test_prerequisite_completion_refreshes_dependents_with_actual_handoff(owner):
    prerequisite = await task_db.create_workspace_task(
        owner, TaskCreate(title="Approve materials", project="Procurement")
    )
    task = await planned(owner)
    task = await task_db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="edit", version=task.version, dependencies=[prerequisite.id]
        ),
    )
    suggestion = await task_db.begin_workspace_task_suggestion(owner, task.id)
    await task_db.finish_workspace_task_suggestion(
        owner, task.id, suggestion.suggestion_request_id, AUTO, []
    )
    await task_db.command_workspace_task(
        owner,
        prerequisite.id,
        TaskCommand(operation="complete", version=prerequisite.version),
    )
    jobs = await task_db.reconsider_workspace_task_plans(owner)
    assert any(job.task.id == task.id and job.owner for job in jobs)
    inputs = await task_db.workspace_task_planning_inputs(owner, task.id)
    assert inputs.context["prerequisites"][0]["status"] == "done"
    assert inputs.context["prerequisites"][0]["project"] == "Procurement"


@pytest.mark.asyncio
async def test_chat_context_waits_for_settled_turn_and_reaches_the_planner(owner):
    task = await planned(owner)
    task = await task_db.bind_workspace_task_session(owner, task.id)
    await db.prisma.chatsession.create(
        data={"id": task.session_id, "userId": owner, "chatStatus": "running"}
    )
    await db.prisma.chatmessage.create(
        data={
            "sessionId": task.session_id,
            "role": "user",
            "content": "The organizer must fit the new square case",
            "sequence": 0,
            "createdAt": datetime.now(UTC) - timedelta(minutes=1),
        }
    )
    assert await task_db.reconsider_workspace_task_plans(owner) == []
    await db.prisma.chatsession.update(
        where={"id": task.session_id}, data={"chatStatus": "idle"}
    )
    jobs = await task_db.reconsider_workspace_task_plans(owner)
    assert len(jobs) == 1 and jobs[0].owner and jobs[0].breakdown
    inputs = await task_db.workspace_task_planning_inputs(owner, task.id)
    assert "new square case" in str(inputs.context["conversations"])


@pytest.mark.asyncio
async def test_late_automatic_breakdown_cannot_replace_preview_after_assignment(owner):
    task = await planned(owner)
    task = await task_db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="edit", version=task.version, description="A revised case"
        ),
    )
    job = next(
        item
        for item in await task_db.reconsider_workspace_task_plans(owner)
        if item.task.id == task.id
    )
    before = job.task.breakdown
    refresh_id = job.task.breakdown_refresh.id
    assigned = await task_db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="assign",
            version=task.version,
            assignee=TaskAssignee(kind="human", id=owner, name="Renamed profile"),
        ),
    )
    await task_db.finish_workspace_task_breakdown(
        owner, task.id, refresh_id, [TaskBreakdownStep(title="Late replacement")]
    )
    current = next(
        item for item in await task_db.list_workspace_tasks(owner) if item.id == task.id
    )
    assert current.assignee.name == "You"
    assert current.breakdown == before
    assert current.dispatch_state is None and current.version == assigned.version


def test_saved_human_identities_display_you_without_changing_another_owner():
    task = WorkspaceTask(
        user_id="me",
        title="Choose material",
        assignee=TaskAssignee(kind="human", id="me", name="Old profile name"),
        suggestion_alternatives=[
            TaskAssignee(kind="human", id="someone-else", name="Other person")
        ],
    )
    assert task.assignee.name == "You"
    assert task.suggestion_alternatives[0].name == "Other person"


@pytest.mark.asyncio
async def test_profile_rename_and_unchanged_context_do_not_restart_planning(owner):
    task = await planned(owner)
    await db.prisma.user.update(
        where={"id": owner}, data={"name": "A different display name"}
    )
    assert await task_db.reconsider_workspace_task_plans(owner) == []
    current = (await task_db.list_workspace_tasks(owner))[0]
    assert current.suggestion_context == task.suggestion_context
    assert current.breakdown == task.breakdown


@pytest.mark.asyncio
async def test_failed_refresh_does_not_loop_and_context_reversion_restores_preview(
    owner,
):
    task = await planned(owner)
    expert = await db.prisma.expert.create(
        data={
            "ownerUserId": owner,
            "name": "CAD helper",
            "role": "Design",
            "identity": "Makes drawings",
        }
    )
    job = (await task_db.reconsider_workspace_task_plans(owner))[0]
    await task_db.finish_workspace_task_suggestion(
        owner, task.id, job.task.suggestion_request_id, None, [], "Model unavailable"
    )
    await task_db.finish_workspace_task_breakdown(
        owner, task.id, job.task.breakdown_refresh.id, [], "Model unavailable"
    )
    assert await task_db.reconsider_workspace_task_plans(owner) == []
    current = (await task_db.list_workspace_tasks(owner))[0]
    assert current.breakdown == task.breakdown
    assert current.breakdown_refresh.state == "error"
    await db.prisma.expert.update(where={"id": expert.id}, data={"isArchived": True})
    await task_db.reconsider_workspace_task_plans(owner)
    current = (await task_db.list_workspace_tasks(owner))[0]
    assert current.breakdown == task.breakdown and current.breakdown_refresh is None


@pytest.mark.asyncio
async def test_original_capture_chat_is_planning_context_and_initial_breakdowns_stay_opt_in(
    owner,
):
    session = await db.prisma.chatsession.create(data={"userId": owner})
    task = await task_db.create_workspace_task(
        owner, TaskCreate(title="Pick packaging"), source_session_id=session.id
    )
    first = (await task_db.reconsider_workspace_task_plans(owner))[0]
    assert first.owner and not first.breakdown and first.task.breakdown is None
    await task_db.finish_workspace_task_suggestion(
        owner, task.id, first.task.suggestion_request_id, AUTO, []
    )
    await db.prisma.chatmessage.create(
        data={
            "sessionId": session.id,
            "role": "user",
            "content": "Use only recyclable inserts",
            "sequence": 0,
            "createdAt": datetime.now(UTC) - timedelta(minutes=1),
        }
    )
    second = (await task_db.reconsider_workspace_task_plans(owner))[0]
    assert second.owner and not second.breakdown
    inputs = await task_db.workspace_task_planning_inputs(owner, task.id)
    assert "recyclable inserts" in str(inputs.context["conversations"])
    assert (await task_db.list_workspace_tasks(owner))[0].session_id is None


@pytest.mark.asyncio
async def test_pending_planning_capacity_prevents_polling_from_fanning_out_model_calls(
    owner,
):
    for index in range(8):
        await task_db.create_workspace_task(owner, TaskCreate(title=f"Task {index}"))
    jobs = await task_db.reconsider_workspace_task_plans(owner)
    assert len(jobs) == 4 and all(job.owner and not job.breakdown for job in jobs)
    assert await task_db.reconsider_workspace_task_plans(owner) == []
    assert owner in await task_db.workspace_task_planning_users()


@pytest.mark.asyncio
async def test_planning_context_excludes_another_users_experts_and_source_chat(owner):
    stranger = str(uuid4())
    await db.prisma.user.create(
        data={"id": stranger, "email": f"{stranger}@tasks.example.invalid"}
    )
    try:
        await db.prisma.expert.create(
            data={
                "ownerUserId": stranger,
                "name": "Private specialist",
                "role": "Private role",
                "identity": "Private identity",
            }
        )
        chat = await db.prisma.chatsession.create(data={"userId": stranger})
        await db.prisma.chatmessage.create(
            data={
                "sessionId": chat.id,
                "role": "user",
                "content": "Private conversation",
                "sequence": 0,
            }
        )
        task = await task_db.create_workspace_task(
            owner, TaskCreate(title="Choose packaging"), source_session_id=chat.id
        )
        inputs = await task_db.workspace_task_planning_inputs(owner, task.id)
        assert inputs.context["conversations"] == []
        assert "Private" not in str(inputs.context)
        assert {candidate.id for candidate in inputs.candidates} == {owner, "auto"}
    finally:
        await db.prisma.user.delete(where={"id": stranger})
