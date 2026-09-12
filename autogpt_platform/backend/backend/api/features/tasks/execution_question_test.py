import os
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from prisma import Json

from backend.api.features.tasks import db as tasks
from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskCommand,
    TaskCreate,
    TaskQuestion,
    TaskQuestionItem,
)
from backend.api.features.tasks.repository import _save
from backend.copilot import db as chat
from backend.copilot.model import (
    ChatSession,
    ChatSessionMetadata,
    clear_pending_question,
)
from backend.data import db

pytestmark = pytest.mark.skipif(
    not os.getenv("TASKS_TEST_DATABASE"), reason="Requires isolated task database"
)
AUTO = TaskAssignee(kind="auto", id="auto", name="AutoPilot")


async def current(owner, task_id):
    return next(
        task for task in await tasks.list_workspace_tasks(owner) if task.id == task_id
    )


async def command(owner, task_id, operation, **fields):
    task = await current(owner, task_id)
    return await tasks.command_workspace_task(
        owner, task_id, TaskCommand(operation=operation, version=task.version, **fields)
    )


async def delegated_child(owner, parent, title="Expert work"):
    task = await tasks.create_workspace_task(
        owner, TaskCreate(title=title, parent_id=parent.id)
    )
    return await command(owner, task.id, "assign", assignee=AUTO)


@pytest.mark.asyncio
async def test_start_one_branch_waits_for_result_then_runs_without_releasing_siblings(
    owner,
):
    parent = await tasks.create_workspace_task(
        owner, TaskCreate(title="Build robot", plan_only=True)
    )
    config = await tasks.create_workspace_task(
        owner, TaskCreate(title="Confirm configuration", parent_id=parent.id)
    )
    work = await delegated_child(owner, parent, "Prepare BOM")
    sibling = await delegated_child(owner, parent, "Prepare assembly")
    await command(owner, work.id, "edit", dependencies=[config.id])
    started = await command(owner, work.id, "start")
    assert started.execution_enabled and started.dispatch_state is None
    assert (await current(owner, parent.id)).plan_only
    assert (await current(owner, sibling.id)).dispatch_state is None
    result = await command(
        owner, config.id, "submit_result", evidence="7.4 V servo configuration approved"
    )
    assert result.status == "done"
    work = await current(owner, work.id)
    assert work.dispatch_state == "pending"
    assert (await current(owner, sibling.id)).dispatch_state is None
    claimed = await tasks.claim_workspace_task_dispatch(owner, work.id)
    assert claimed
    authority = await tasks.start_workspace_task_run(
        owner, claimed.session_id, "bom-turn"
    )
    assert authority.can_execute
    submitted = await tasks.workspace_task_run_event(
        owner,
        claimed.session_id,
        "result",
        text="BOM ready for review",
        turn_id="bom-turn",
    )
    assert submitted.result_version == 1 and submitted.status == "needs_you"
    assert (await current(owner, parent.id)).plan_only


@pytest.mark.asyncio
async def test_holding_parent_revokes_child_start_and_clears_queued_attempt(owner):
    parent = await tasks.create_workspace_task(
        owner, TaskCreate(title="Outcome", plan_only=True)
    )
    child = await delegated_child(owner, parent)
    child = await command(owner, child.id, "start")
    assert child.dispatch_state == "pending"
    await command(owner, parent.id, "hold")
    child = await current(owner, child.id)
    assert not child.execution_enabled and child.dispatch_state is None
    assert await tasks.claim_workspace_task_dispatch(owner, child.id) is None
    authority = await tasks.start_workspace_task_run(
        owner, child.session_id, "stale-turn"
    )
    assert not authority.can_execute


@pytest.mark.asyncio
async def test_start_respects_proposed_scope_paused_parents_and_active_attempts(owner):
    parent = await tasks.create_workspace_task(
        owner, TaskCreate(title="Outcome", plan_only=True)
    )
    child = await delegated_child(owner, parent)
    parent.accepted = False
    await _save(db.prisma, parent)
    with pytest.raises(TaskConflict, match="Accept"):
        await command(owner, child.id, "start")
    await command(owner, parent.id, "accept_scope")
    await command(owner, parent.id, "pause")
    with pytest.raises(TaskConflict, match="paused parent"):
        await command(owner, child.id, "start")
    await command(owner, parent.id, "resume")
    child = await command(owner, child.id, "start")
    await tasks.claim_workspace_task_dispatch(owner, child.id)
    with pytest.raises(TaskConflict, match="Stop"):
        await command(owner, child.id, "start")


async def questioning_task(owner):
    task = await tasks.create_workspace_task(
        owner, TaskCreate(title="Choose materials", plan_only=True)
    )
    task = await command(owner, task.id, "assign", assignee=AUTO)
    task.session_id = str(uuid4())
    await _save(db.prisma, task)
    await db.prisma.chatsession.create(
        data={
            "id": task.session_id,
            "userId": owner,
            "metadata": Json({"workspace_task_id": task.id, "dry_run": True}),
        }
    )
    question = TaskQuestion(
        questions=[TaskQuestionItem(keyword="material", question="Which material?")]
    )
    task = await tasks.workspace_task_run_event(
        owner, task.session_id, "question", question=question
    )
    return task


@pytest.mark.asyncio
async def test_answer_resolves_home_and_task_atomically_even_when_execution_is_held(
    owner,
):
    task = await questioning_task(owner)
    pending = await chat.get_sessions_with_pending_question(owner)
    assert (
        len(pending) == 1
        and pending[0].metadata.pending_question.question_id == task.question.id
    )
    with pytest.raises(TaskConflict, match="every question"):
        await command(
            owner, task.id, "answer", question_id=task.question.id, answers={}
        )
    assert len(await chat.get_sessions_with_pending_question(owner)) == 1
    with pytest.raises(TaskConflict, match="outstanding question"):
        await command(owner, task.id, "start")
    answer = await command(
        owner,
        task.id,
        "answer",
        question_id=task.question.id,
        answers={"material": "Linen"},
        feedback="Website connector is ready.",
    )
    assert answer.question.answers == {"material": "Linen"}
    assert answer.dispatch_state is None
    assert "Website connector is ready." in answer.dispatch_message
    assert await chat.get_sessions_with_pending_question(owner) == []
    session = await db.prisma.chatsession.find_unique(where={"id": task.session_id})
    assert session.metadata["dry_run"] is True
    with pytest.raises(TaskConflict, match="no longer"):
        await command(
            owner,
            task.id,
            "answer",
            question_id=task.question.id,
            answers={"material": "Cotton"},
        )
    started = await command(owner, task.id, "start")
    assert started.dispatch_state == "pending" and "Linen" in started.dispatch_message


@pytest.mark.asyncio
async def test_stale_answer_cannot_clear_new_question_and_cancellation_clears_home(
    owner,
):
    task = await questioning_task(owner)
    old = task.question.id
    question = TaskQuestion(
        questions=[TaskQuestionItem(keyword="size", question="Which size?")]
    )
    task = await tasks.workspace_task_run_event(
        owner, task.session_id, "question", question=question
    )
    with pytest.raises(TaskConflict, match="no longer"):
        await command(
            owner, task.id, "answer", question_id=old, answers={"material": "Linen"}
        )
    pending = await chat.get_sessions_with_pending_question(owner)
    assert (
        len(pending) == 1
        and pending[0].metadata.pending_question.question_id == question.id
    )
    await command(owner, task.id, "cancel")
    assert await chat.get_sessions_with_pending_question(owner) == []


@pytest.mark.asyncio
async def test_ordinary_turn_does_not_clear_an_unanswered_task_question(
    owner, monkeypatch
):
    task = await questioning_task(owner)
    info = (await chat.get_sessions_with_pending_question(owner))[0]
    session = ChatSession.new(user_id=owner, dry_run=True)
    session.session_id = task.session_id
    session.metadata = ChatSessionMetadata(
        workspace_task_id=task.id, pending_question=info.metadata.pending_question
    )
    monkeypatch.setattr("backend.copilot.model.tasks_db", lambda: tasks)
    clear = AsyncMock()
    monkeypatch.setattr(
        "backend.copilot.model.chat_db",
        lambda: type("Chat", (), {"clear_session_pending_question": clear}),
    )
    await clear_pending_question(session)
    assert session.metadata.pending_question and not clear.called


@pytest.mark.asyncio
async def test_answer_after_reassignment_clears_the_original_chat_reminder(owner):
    task = await questioning_task(owner)
    session_id = task.session_id
    unrelated = await db.prisma.chatsession.create(
        data={
            "userId": owner,
            "metadata": Json(
                {
                    "pending_question": {
                        "text": "Another question",
                        "asked_at": task.question.asked_at.isoformat(),
                        "question_id": str(uuid4()),
                    }
                }
            ),
        }
    )
    task = await command(
        owner,
        task.id,
        "assign",
        assignee=TaskAssignee(kind="human", id=owner, name="You"),
    )
    assert task.session_id is None and session_id in task.previous_session_ids
    assert task.status == "needs_you"
    assert len(await chat.get_sessions_with_pending_question(owner)) == 2
    answered = await command(
        owner,
        task.id,
        "answer",
        question_id=task.question.id,
        answers={"material": "Linen"},
    )
    assert answered.dispatch_state is None and answered.question.answers == {
        "material": "Linen"
    }
    remaining = await chat.get_sessions_with_pending_question(owner)
    assert [item.session_id for item in remaining] == [unrelated.id]
