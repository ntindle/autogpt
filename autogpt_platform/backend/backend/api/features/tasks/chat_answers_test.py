from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from prisma import Json

from backend.api.features.tasks import db as tasks
from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.execution_policy import task_execution_policy
from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskQuestion,
    TaskQuestionItem,
    WorkspaceTask,
)
from backend.api.features.tasks.repository import _save
from backend.copilot import db as chat
from backend.copilot.model import ChatMessage, ChatSession
from backend.copilot.permissions import CopilotPermissions
from backend.copilot.task_context import task_context_block
from backend.copilot.tools.manage_tasks import ManageTasksTool, WorkspaceTasksResponse
from backend.data import db

REPLY = "it's private, auth with GitHub"


async def asking(owner, monkeypatch, *, held=False, extra=False):
    task = WorkspaceTask(
        user_id=owner,
        title="Define wholesale sample package offer",
        assignee=TaskAssignee(kind="auto", id="auto", name="AutoPilot"),
        status="working",
        session_id="repo-" + owner,
        plan_only=held,
    )
    await _save(db.prisma, task)
    await db.prisma.chatsession.create(
        data={
            "id": task.session_id,
            "userId": owner,
            "metadata": Json({"workspace_task_id": task.id}),
        }
    )
    questions = [
        TaskQuestionItem(
            keyword="repository",
            question="Can you confirm the repository and how to access it?",
        )
    ]
    if extra:
        questions.append(
            TaskQuestionItem(
                keyword="publish",
                question="Approve publishing the offer?",
                purpose="approval",
            )
        )
    task = await tasks.workspace_task_run_event(
        owner, task.session_id, "question", question=TaskQuestion(questions=questions)
    )
    session = ChatSession.new(user_id=owner, dry_run=False)
    session.session_id = task.session_id
    session.metadata.workspace_task_id = task.id
    for module in ("execution_policy",):
        monkeypatch.setattr(
            f"backend.api.features.tasks.{module}.tasks_db", lambda: tasks
        )
    for module in ("tools.manage_tasks", "tools.task_answers", "task_context"):
        monkeypatch.setattr(f"backend.copilot.{module}.tasks_db", lambda: tasks)
    monkeypatch.setattr(
        "backend.copilot.tools.task_answers.invalidate_session_cache", AsyncMock()
    )
    return task, session


async def reply(session, text):
    row = await db.prisma.chatmessage.create(
        data={
            "sessionId": session.session_id,
            "role": "user",
            "content": text,
            "sequence": len(session.messages),
        }
    )
    session.messages.append(
        ChatMessage(id=row.id, role="user", content=text, sequence=row.sequence)
    )
    return row


@pytest.mark.asyncio
@pytest.mark.parametrize("held", [False, True])
async def test_private_repo_reply_preserves_tools_and_resolves_in_current_turn(
    owner, monkeypatch, held
):
    task, session = await asking(owner, monkeypatch, held=held)
    assert len(await chat.get_sessions_with_pending_question(owner)) == 1
    await reply(session, REPLY)
    parent_permissions = CopilotPermissions(
        tools=["delete_workspace_file"], blocks=["disallowed-block"]
    )
    permissions, context = await task_execution_policy(
        session, parent_permissions, "reply-turn"
    )
    assert permissions is parent_permissions
    assert "not a tool prohibition" in context
    assert "answer_question" in context and task.question.id in context
    assert ("explicitly on a planning hold" in context) == held
    with pytest.raises(RuntimeError, match="already claimed"):
        await task_execution_policy(session, parent_permissions, "reply-turn")
    result = await ManageTasksTool()._execute(
        owner,
        session,
        operation="answer_question",
        question_id=task.question.id,
        answers={"repository": REPLY},
    )
    assert isinstance(result, WorkspaceTasksResponse), result
    updated = result.tasks[0]
    assert updated.question.answers == {"repository": REPLY}
    assert updated.question.questions[0].answered_by == owner
    assert updated.plan_only == held
    assert updated.last_turn_id == "reply-turn"
    assert updated.dispatch_state == (None if held else "sent")
    assert updated.dispatch_message == ""
    assert session.metadata.pending_question is None
    assert await chat.get_sessions_with_pending_question(owner) == []
    assert await tasks.claim_workspace_task_dispatch(owner, task.id) is None
    fresh_context = await task_context_block(session)
    assert REPLY in fresh_context
    assert "Waiting for input:" not in fresh_context
    again = await ManageTasksTool()._execute(
        owner,
        session,
        operation="answer_question",
        question_id=task.question.id,
        answers={"repository": REPLY},
    )
    assert again.tasks[0].version == updated.version
    if held:
        with pytest.raises(TaskConflict, match="not delegated"):
            await tasks.workspace_task_run_event(
                owner,
                session.session_id,
                "result",
                "Inspected repository",
                turn_id="reply-turn",
            )
    else:
        submitted = await tasks.workspace_task_run_event(
            owner,
            session.session_id,
            "result",
            "Repository inspected using authorized GitHub access",
            turn_id="reply-turn",
        )
        assert submitted.result_version == 1 and submitted.status == "needs_you"
        assert submitted.question is None
        finished = await tasks.workspace_task_run_event(
            owner, session.session_id, "finished", turn_id="reply-turn"
        )
        assert finished.dispatch_state == "finished" and finished.status == "needs_you"


@pytest.mark.asyncio
async def test_partial_answers_corrections_and_unrelated_chat_preserve_approval(
    owner, monkeypatch
):
    task, session = await asking(owner, monkeypatch, extra=True)
    first = await reply(session, REPLY)
    partial = await tasks.answer_workspace_task_from_chat(
        owner, session.session_id, task.question.id, {"repository": REPLY}, first.id
    )
    assert partial.question.answers is None and partial.status == "needs_you"
    assert partial.question.questions[1].answer is None
    home = await chat.get_sessions_with_pending_question(owner)
    assert (
        len(home) == 1
        and home[0].metadata.pending_question.text == "Approve publishing the offer?"
    )
    correction = "Correction: use the private wholesale repo, not the public demo."
    second = await reply(session, correction)
    corrected = await tasks.answer_workspace_task_from_chat(
        owner,
        session.session_id,
        task.question.id,
        {"repository": correction},
        second.id,
    )
    assert corrected.question.questions[0].answer == correction
    assert (
        REPLY in corrected.question.context and correction in corrected.question.context
    )
    ambiguous = await reply(session, "Which part needs approval?")
    context_only = await tasks.answer_workspace_task_from_chat(
        owner, session.session_id, task.question.id, {}, ambiguous.id
    )
    assert context_only.question.questions[1].answer is None
    assert (
        context_only.status == "needs_you" and context_only.dispatch_state != "pending"
    )
    with pytest.raises(TaskConflict, match="outstanding questions"):
        await tasks.workspace_task_run_event(
            owner, session.session_id, "result", "All done"
        )


@pytest.mark.asyncio
async def test_answer_rejects_stale_or_fabricated_evidence_and_other_users(
    owner, monkeypatch
):
    task, session = await asking(owner, monkeypatch)
    first = await reply(session, REPLY)
    for question_id, answers, source_id in (
        ("stale", {"repository": REPLY}, first.id),
        (task.question.id, {"repository": "Publish without review"}, first.id),
        (task.question.id, {"missing-key": REPLY}, first.id),
        (task.question.id, {"repository": REPLY}, "assistant-message"),
    ):
        with pytest.raises(TaskConflict):
            await tasks.answer_workspace_task_from_chat(
                owner, session.session_id, question_id, answers, source_id
            )
    with pytest.raises(TaskConflict):
        await tasks.answer_workspace_task_from_chat(
            "other-user",
            session.session_id,
            task.question.id,
            {"repository": REPLY},
            first.id,
        )
    fresh = (await tasks.list_workspace_tasks(owner))[0]
    assert fresh.question.answers is None
    assert len(await chat.get_sessions_with_pending_question(owner)) == 1
    await db.prisma.chatmessage.delete_many(where={"sessionId": session.session_id})
    old = await db.prisma.chatmessage.create(
        data={
            "sessionId": session.session_id,
            "role": "user",
            "content": REPLY,
            "sequence": 0,
            "createdAt": task.question.asked_at - timedelta(seconds=1),
        }
    )
    with pytest.raises(TaskConflict, match="saved user reply"):
        await tasks.answer_workspace_task_from_chat(
            owner, session.session_id, task.question.id, {"repository": REPLY}, old.id
        )


@pytest.mark.asyncio
async def test_answer_does_not_impersonate_an_expert(owner, monkeypatch):
    task, session = await asking(owner, monkeypatch)
    task.question.questions[0].target = TaskAssignee(
        kind="expert", id="expert", name="Otto"
    )
    await _save(db.prisma, task)
    source = await reply(session, REPLY)
    with pytest.raises(TaskConflict, match="addressed to the user"):
        await tasks.answer_workspace_task_from_chat(
            owner,
            session.session_id,
            task.question.id,
            {"repository": REPLY},
            source.id,
        )


@pytest.mark.asyncio
async def test_automatic_dispatch_is_not_a_human_answer(owner, monkeypatch):
    task, session = await asking(owner, monkeypatch)
    source = await reply(session, "Run the delegated task")
    task.dispatch_id = source.id
    await _save(db.prisma, task)
    with pytest.raises(TaskConflict, match="saved user reply"):
        await tasks.answer_workspace_task_from_chat(
            owner,
            session.session_id,
            task.question.id,
            {"repository": source.content},
            source.id,
        )


@pytest.mark.asyncio
async def test_existing_stuck_conversation_can_recover_from_its_prior_answer(
    owner, monkeypatch
):
    task, session = await asking(owner, monkeypatch)
    original = await reply(session, REPLY)
    await reply(session, "Can you continue now?")
    await task_execution_policy(session, None, "recovered-turn")
    result = await ManageTasksTool()._execute(
        owner,
        session,
        operation="answer_question",
        question_id=task.question.id,
        answers={"repository": REPLY},
        source_quote=REPLY,
    )
    assert isinstance(result, WorkspaceTasksResponse), result
    assert result.tasks[0].question.answers == {"repository": REPLY}
    assert result.tasks[0].last_turn_id == "recovered-turn"
    assert result.tasks[0].dispatch_state == "sent"
    correction = await reply(session, "Actually use the wholesale-v2 repository")
    await tasks.answer_workspace_task_from_chat(
        owner,
        session.session_id,
        task.question.id,
        {"repository": correction.content},
        correction.id,
    )
    with pytest.raises(TaskConflict, match="latest user reply"):
        await tasks.answer_workspace_task_from_chat(
            owner,
            session.session_id,
            task.question.id,
            {"repository": REPLY},
            original.id,
        )
