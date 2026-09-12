import os
from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from prisma import Json

from backend.api.features.tasks import db as task_db
from backend.api.features.tasks import service
from backend.api.features.tasks.context import planning_context
from backend.api.features.tasks.domain import TaskConflict, record
from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskCommand,
    TaskCreate,
    TaskQuestion,
    TaskQuestionItem,
)
from backend.api.features.tasks.repository import _save
from backend.copilot.model import ChatSession
from backend.copilot.tools.manage_tasks import ManageTasksTool, WorkspaceTasksResponse
from backend.copilot.tools.models import ErrorResponse
from backend.data import db

pytestmark = pytest.mark.skipif(
    not os.getenv("TASKS_TEST_DATABASE"), reason="Requires isolated task database"
)
AUTO = TaskAssignee(kind="auto", id="auto", name="AutoPilot")


async def manager(owner, monkeypatch, expert_id=None):
    row = await db.prisma.chatsession.create(
        data={"userId": owner, "expertId": expert_id}
    )
    monkeypatch.setattr(service, "dispatch_user_tasks", AsyncMock())
    monkeypatch.setattr(service, "enqueue_cancel_task", AsyncMock())
    return ChatSession(
        session_id=row.id,
        user_id=owner,
        expert_id=expert_id,
        started_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        usage=[],
        messages=[],
    )


async def current(owner, task_id):
    return next(
        task for task in await task_db.list_workspace_tasks(owner) if task.id == task_id
    )


async def command(owner, task_id, operation, **fields):
    task = await current(owner, task_id)
    return await task_db.command_workspace_task(
        owner, task_id, TaskCommand(operation=operation, version=task.version, **fields)
    )


@pytest.mark.asyncio
async def test_human_result_is_handed_to_coordinator_and_cross_project_dependent(owner):
    parent = await task_db.create_workspace_task(
        owner, TaskCreate(title="Prepare sample kits")
    )
    parent = await command(owner, parent.id, "assign", assignee=AUTO)
    await task_db.workspace_task_run_event(owner, parent.session_id, "finished")
    child = await task_db.create_workspace_task(
        owner, TaskCreate(title="Choose the materials", parent_id=parent.id)
    )
    await command(
        owner,
        child.id,
        "assign",
        assignee=TaskAssignee(kind="human", id=owner, name="You"),
    )
    dependent = await task_db.create_workspace_task(
        owner, TaskCreate(title="Print inserts", project="Manufacturing")
    )
    await command(owner, dependent.id, "edit", dependencies=[child.id])
    await command(owner, dependent.id, "assign", assignee=AUTO)
    evidence = "Selected linen and cotton. [Materials](https://example.invalid/approved-materials)"
    result = await command(owner, child.id, "submit_result", evidence=evidence)
    tasks = await task_db.list_workspace_tasks(owner)
    assert result.result == evidence and result.result_version == 1
    assert result.status == "done" and result.events[-1].actor == owner
    assert not any(task.review_of == child.id for task in tasks)
    assert (await current(owner, parent.id)).dispatch_state == "pending"
    assert (await current(owner, dependent.id)).dispatch_state == "pending"
    assert (
        planning_context(await current(owner, dependent.id), tasks)["prerequisites"][0][
            "result"
        ]
        == evidence
    )
    result = await command(
        owner, child.id, "submit_result", evidence=evidence + " Final count: 24."
    )
    assert result.result_version == 2 and result.status == "done"


@pytest.mark.asyncio
async def test_human_result_rejects_blank_stale_agent_and_incomplete_parent(owner):
    parent = await task_db.create_workspace_task(owner, TaskCreate(title="Launch"))
    child = await task_db.create_workspace_task(
        owner, TaskCreate(title="Required physical work", parent_id=parent.id)
    )
    with pytest.raises(TaskConflict, match="Provide"):
        await command(owner, child.id, "submit_result", evidence="  ")
    with pytest.raises(TaskConflict, match="required"):
        await command(owner, parent.id, "submit_result", evidence="A plan")
    await command(owner, child.id, "edit", title="Corrected work")
    with pytest.raises(TaskConflict, match="changed"):
        await task_db.command_workspace_task(
            owner,
            child.id,
            TaskCommand(
                operation="submit_result", version=child.version, evidence="Old draft"
            ),
        )
    await command(owner, child.id, "assign", assignee=AUTO)
    with pytest.raises(TaskConflict, match="Agent results"):
        await command(owner, child.id, "submit_result", evidence="Bypass review")
    assert (await current(owner, child.id)).result is None


@pytest.mark.asyncio
async def test_reparent_preserves_live_expert_state_and_moves_inherited_projects(
    owner, monkeypatch
):
    session = await manager(owner, monkeypatch)
    old = await task_db.create_workspace_task(
        owner, TaskCreate(title="Old outcome", project="Old project")
    )
    new = await task_db.create_workspace_task(
        owner, TaskCreate(title="New outcome", project="New project")
    )
    task = await task_db.create_workspace_task(
        owner, TaskCreate(title="Design grid", parent_id=old.id)
    )
    nested = await task_db.create_workspace_task(
        owner, TaskCreate(title="Layout", parent_id=task.id)
    )
    expert = await db.prisma.expert.create(
        data={
            "ownerUserId": owner,
            "name": "Designer",
            "role": "CAD",
            "identity": "Synthetic local regression Expert",
        }
    )
    task.assignee = TaskAssignee(kind="expert", id=expert.id, name=expert.name)
    task.status, task.dispatch_state, task.session_id = "working", "sent", str(uuid4())
    task.dispatch_id, task.last_turn_id = str(uuid4()), "active-turn"
    task.started_turn_ids, task.previous_session_ids = [
        "earlier-turn",
        "active-turn",
    ], ["earlier-session"]
    task.result, task.result_version = "First layout", 1
    task.question = TaskQuestion(
        questions=[TaskQuestionItem(question="Which size?", keyword="size")],
        answers={"size": "24 slots"},
        answered_by=owner,
    )
    record(task, expert.name, "Applying the requested dimensions")
    await _save(db.prisma, task)
    before = task.model_dump()
    tool = ManageTasksTool()
    result = await tool._execute(
        owner,
        session,
        operation="reparent",
        task_id=task.id,
        new_parent_id=new.id,
        version=task.version,
    )
    assert isinstance(result, WorkspaceTasksResponse), result
    moved = result.tasks[0]
    assert (
        moved.id == task.id
        and moved.parent_id == new.id
        and moved.project == "New project"
    )
    changed = {"parent_id", "project", "updated_at", "version", "events"}
    assert {
        key: value for key, value in moved.model_dump().items() if key not in changed
    } == {key: value for key, value in before.items() if key not in changed}
    assert moved.events[:-1] == task.events and moved.version == task.version + 1
    assert (await current(owner, nested.id)).project == "New project"
    assert (
        await task_db.workspace_task_for_session(owner, task.session_id)
    ).id == task.id
    corrected = await tool._execute(
        owner,
        session,
        operation="edit",
        task_id=task.id,
        title="Design the 24-slot grid",
        description="Use the existing answered dimensions.",
    )
    assert isinstance(corrected, WorkspaceTasksResponse)
    assert (
        corrected.tasks[0].status == "working"
        and corrected.tasks[0].question == task.question
    )
    detached = await tool._execute(
        owner,
        session,
        operation="reparent",
        task_id=task.id,
        new_parent_id=None,
        project="Independent",
    )
    assert isinstance(detached, WorkspaceTasksResponse)
    assert (
        detached.tasks[0].parent_id is None
        and detached.tasks[0].project == "Independent"
    )
    assert len(await task_db.list_workspace_tasks(owner)) == 4


@pytest.mark.asyncio
async def test_reparent_rejects_cycles_and_new_active_execution_barriers(
    owner, monkeypatch
):
    session = await manager(owner, monkeypatch)
    parent = await task_db.create_workspace_task(owner, TaskCreate(title="Parent"))
    child = await task_db.create_workspace_task(
        owner, TaskCreate(title="Child", parent_id=parent.id)
    )
    held = await task_db.create_workspace_task(
        owner, TaskCreate(title="Held", plan_only=True)
    )
    tool = ManageTasksTool()
    cycle = await tool._execute(
        owner, session, operation="reparent", task_id=parent.id, new_parent_id=child.id
    )
    assert isinstance(cycle, ErrorResponse)
    assert (await current(owner, parent.id)).parent_id is None
    await command(owner, held.id, "edit", dependencies=[child.id])
    inherited_cycle = await tool._execute(
        owner, session, operation="reparent", task_id=parent.id, new_parent_id=held.id
    )
    assert isinstance(inherited_cycle, ErrorResponse)
    await command(owner, held.id, "edit", dependencies=[])
    child.status, child.dispatch_state = "working", "sent"
    await _save(db.prisma, child)
    blocked = await tool._execute(
        owner, session, operation="reparent", task_id=parent.id, new_parent_id=held.id
    )
    assert isinstance(blocked, ErrorResponse) and "Stop" in blocked.message
    assert (await current(owner, child.id)).status == "working"
    assert (await current(owner, parent.id)).parent_id is None


@pytest.mark.asyncio
async def test_autopilot_reassigns_confirmed_owner_after_stopping_and_retains_handoff(
    owner, monkeypatch
):
    session = await manager(owner, monkeypatch)
    task = await task_db.create_workspace_task(owner, TaskCreate(title="Design"))
    task = await command(owner, task.id, "assign", assignee=AUTO)
    original_session = task.session_id
    task.status, task.dispatch_state = "working", "sent"
    task.result, task.result_version = "Draft evidence", 1
    task.question = TaskQuestion(
        questions=[TaskQuestionItem(question="Size?", keyword="size")],
        answers={"size": "24"},
        answered_by=owner,
    )
    await _save(db.prisma, task)
    expert = await db.prisma.expert.create(
        data={
            "ownerUserId": owner,
            "name": "Grid designer",
            "role": "CAD",
            "identity": "Synthetic local regression Expert",
        }
    )
    tool = ManageTasksTool()
    args = {
        "operation": "assign",
        "task_id": task.id,
        "assignee_kind": "expert",
        "assignee_id": expert.id,
    }
    denied = await tool._execute(owner, session, **args)
    assert isinstance(denied, ErrorResponse) and "Stop" in denied.message
    paused = await tool._execute(owner, session, operation="pause", task_id=task.id)
    assert isinstance(paused, WorkspaceTasksResponse) and paused.tasks[0].paused
    service.enqueue_cancel_task.assert_awaited_once_with(original_session)
    await task_db.workspace_task_run_event(owner, original_session, "finished")
    assigned = await tool._execute(owner, session, **args)
    assert isinstance(assigned, WorkspaceTasksResponse), assigned
    handoff = assigned.tasks[0]
    assert handoff.assignee.id == expert.id and handoff.assignee.name == expert.name
    assert handoff.question == task.question and handoff.result == "Draft evidence"
    assert handoff.paused and handoff.dispatch_state is None
    assert original_session in handoff.previous_session_ids
    resumed = await tool._execute(owner, session, operation="resume", task_id=task.id)
    assert isinstance(resumed, WorkspaceTasksResponse)
    assert resumed.tasks[0].dispatch_state == "pending"
    assert resumed.tasks[0].session_id != original_session
    await task_db.workspace_task_run_event(
        owner, original_session, "result", "Late old-owner result"
    )
    assert (await current(owner, task.id)).result == "Draft evidence"


@pytest.mark.asyncio
async def test_cancel_retires_duplicate_branch_without_deleting_and_can_reopen(
    owner, monkeypatch
):
    session = await manager(owner, monkeypatch)
    parent = await task_db.create_workspace_task(owner, TaskCreate(title="Duplicate"))
    child = await task_db.create_workspace_task(
        owner, TaskCreate(title="Unfinished child", parent_id=parent.id)
    )
    completed = await task_db.create_workspace_task(
        owner, TaskCreate(title="Keep evidence", parent_id=parent.id)
    )
    await command(owner, completed.id, "submit_result", evidence="Historical work")
    tool = ManageTasksTool()
    canceled = await tool._execute(
        owner, session, operation="cancel", task_id=parent.id
    )
    assert isinstance(canceled, WorkspaceTasksResponse)
    assert (await current(owner, parent.id)).status == "canceled"
    assert (await current(owner, child.id)).status == "canceled"
    assert (await current(owner, completed.id)).result == "Historical work"
    reopened = await tool._execute(
        owner, session, operation="reopen", task_id=parent.id
    )
    assert (
        isinstance(reopened, WorkspaceTasksResponse)
        and reopened.tasks[0].status == "todo"
    )
    assert len(await task_db.list_workspace_tasks(owner)) == 3


@pytest.mark.asyncio
async def test_manager_permissions_use_persisted_session_and_cannot_touch_another_user(
    owner, monkeypatch
):
    session = await manager(owner, monkeypatch)
    expert = await db.prisma.expert.create(
        data={
            "ownerUserId": owner,
            "name": "Limited",
            "role": "CAD",
            "identity": "Synthetic local regression Expert",
        }
    )
    expert_session = await manager(owner, monkeypatch, expert.id)
    target = await task_db.create_workspace_task(owner, TaskCreate(title="Keep this"))
    tool = ManageTasksTool()
    expert_session.expert_id = None
    denied = await tool._execute(
        owner, expert_session, operation="edit", task_id=target.id, title="Escalated"
    )
    assert isinstance(denied, ErrorResponse) and "Only AutoPilot" in denied.message
    stale = await tool._execute(
        owner,
        session,
        operation="edit",
        task_id=target.id,
        title="Stale",
        version=target.version - 1,
    )
    assert isinstance(stale, ErrorResponse) and "changed" in stale.message
    stranger = str(uuid4())
    await db.prisma.user.create(
        data={"id": stranger, "email": f"{stranger}@tasks.example.invalid"}
    )
    try:
        private = await task_db.create_workspace_task(
            stranger, TaskCreate(title="Private")
        )
        denied = await tool._execute(
            owner, session, operation="cancel", task_id=private.id
        )
        assert isinstance(denied, ErrorResponse)
        denied = await tool._execute(
            owner,
            session,
            operation="reparent",
            task_id=target.id,
            new_parent_id=private.id,
        )
        assert isinstance(denied, ErrorResponse)
        assert (await current(owner, target.id)).title == "Keep this"
        assert (await current(stranger, private.id)).status == "todo"
        await db.prisma.chatsession.update(
            where={"id": session.session_id},
            data={"metadata": Json({"workspace_task_id": target.id})},
        )
        detached = await tool._execute(
            owner, session, operation="cancel", task_id=target.id
        )
        assert isinstance(detached, ErrorResponse) and "no longer" in detached.message
    finally:
        await db.prisma.user.delete(where={"id": stranger})


@pytest.mark.asyncio
async def test_review_moves_with_deliverable_and_reassignment_retires_stale_review(
    owner, monkeypatch
):
    session = await manager(owner, monkeypatch)
    old = await task_db.create_workspace_task(
        owner, TaskCreate(title="Old outcome", project="Old")
    )
    new = await task_db.create_workspace_task(
        owner, TaskCreate(title="New outcome", project="New")
    )
    task = await task_db.create_workspace_task(
        owner, TaskCreate(title="Draft", parent_id=old.id)
    )
    task = await command(owner, task.id, "assign", assignee=AUTO)
    await task_db.workspace_task_run_event(
        owner, task.session_id, "result", "Existing evidence"
    )
    await task_db.workspace_task_run_event(owner, task.session_id, "finished")
    tool = ManageTasksTool()
    moved = await tool._execute(
        owner, session, operation="reparent", task_id=task.id, new_parent_id=new.id
    )
    assert isinstance(moved, WorkspaceTasksResponse)
    review = next(
        item
        for item in await task_db.list_workspace_tasks(owner)
        if item.review_of == task.id
    )
    assert review.parent_id == new.id and review.project == "New"
    assert review.status == "needs_you" and review.review_version == 1
    reassigned = await tool._execute(
        owner, session, operation="assign", task_id=task.id, assignee_kind="human"
    )
    assert isinstance(reassigned, WorkspaceTasksResponse)
    assert (await current(owner, review.id)).status == "canceled"
    assert reassigned.tasks[0].result == "Existing evidence"
    await command(owner, task.id, "submit_result", evidence="Finished by the human")
    retired = await tool._execute(owner, session, operation="cancel", task_id=task.id)
    assert (
        isinstance(retired, WorkspaceTasksResponse)
        and retired.tasks[0].status == "canceled"
    )
    assert retired.tasks[0].result == "Finished by the human"


@pytest.mark.asyncio
async def test_management_follows_current_binding_after_existing_work_moves_to_child(
    owner, monkeypatch
):
    session = await manager(owner, monkeypatch)
    parent = await task_db.create_workspace_task(owner, TaskCreate(title="Outcome"))
    child = await task_db.create_workspace_task(
        owner, TaskCreate(title="Original work", parent_id=parent.id)
    )
    child.session_id = session.session_id
    await _save(db.prisma, child)
    await db.prisma.chatsession.update(
        where={"id": session.session_id},
        data={"metadata": Json({"workspace_task_id": parent.id})},
    )
    result = await ManageTasksTool()._execute(
        owner,
        session,
        operation="edit",
        task_id=child.id,
        description="Continue the preserved work",
    )
    assert isinstance(result, WorkspaceTasksResponse)
    assert (
        result.tasks[0].id == child.id
        and result.tasks[0].session_id == session.session_id
    )


@pytest.mark.asyncio
async def test_human_answers_inherited_question_without_queueing_an_agent_turn(owner):
    task = await task_db.create_workspace_task(
        owner, TaskCreate(title="Physical sample handoff")
    )
    task = await command(owner, task.id, "assign", assignee=AUTO)
    question = TaskQuestion(
        questions=[TaskQuestionItem(question="Which fabric?", keyword="fabric")]
    )
    await task_db.workspace_task_run_event(
        owner, task.session_id, "question", question=question
    )
    await task_db.workspace_task_run_event(owner, task.session_id, "finished")
    await command(
        owner,
        task.id,
        "assign",
        assignee=TaskAssignee(kind="human", id=owner, name="You"),
    )
    answered = await command(
        owner, task.id, "answer", question_id=question.id, answers={"fabric": "Linen"}
    )
    assert answered.question.answers == {"fabric": "Linen"}
    assert answered.dispatch_state is None
    assert answered.activity == "Answer recorded"
    completed = await command(
        owner, task.id, "submit_result", evidence="Prepared the linen samples"
    )
    assert completed.status == "done" and completed.dispatch_state is None


@pytest.mark.asyncio
async def test_answer_cannot_reactivate_a_canceled_task(owner):
    task = await task_db.create_workspace_task(
        owner, TaskCreate(title="Canceled question")
    )
    task = await command(owner, task.id, "assign", assignee=AUTO)
    question = TaskQuestion(
        questions=[TaskQuestionItem(question="Which fabric?", keyword="fabric")]
    )
    await task_db.workspace_task_run_event(
        owner, task.session_id, "question", question=question
    )
    await task_db.workspace_task_run_event(owner, task.session_id, "finished")
    await command(owner, task.id, "cancel")
    with pytest.raises(TaskConflict, match="Reopen"):
        await command(
            owner,
            task.id,
            "answer",
            question_id=question.id,
            answers={"fabric": "Linen"},
        )
    canceled = await current(owner, task.id)
    assert canceled.status == "canceled" and canceled.dispatch_state is None
    assert canceled.question.answers is None
