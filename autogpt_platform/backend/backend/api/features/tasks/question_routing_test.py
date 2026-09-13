from unittest.mock import AsyncMock

import pytest
from prisma import Json

from backend.api.features.tasks import db as tasks
from backend.api.features.tasks import service
from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.execution_policy import task_execution_policy
from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskCommand,
    TaskQuestion,
    TaskQuestionItem,
    WorkspaceTask,
)
from backend.api.features.tasks.question_routing import (
    prepare_question_tasks,
    refresh_question_state,
)
from backend.api.features.tasks.repository import _save
from backend.copilot.model import ChatSession, ChatSessionMetadata
from backend.data import db
from backend.util.exceptions import NotFoundError

EXPERT = TaskAssignee(kind="expert", id="strategist", name="Strategist")
REQUESTER = TaskAssignee(kind="expert", id="researcher", name="Researcher")
AUTO = TaskAssignee(kind="auto", id="auto", name="AutoPilot")


async def asking(owner):
    task = WorkspaceTask(
        user_id=owner,
        title="Research retailers",
        assignee=REQUESTER,
        session_id="source-" + owner,
        dispatch_state="sent",
        status="working",
    )
    await _save(db.prisma, task)
    await db.prisma.chatsession.create(
        data={"id": task.session_id, "userId": owner, "metadata": Json({})}
    )
    return await tasks.workspace_task_run_event(
        owner,
        task.session_id,
        "question",
        question=TaskQuestion(
            questions=[
                TaskQuestionItem(
                    keyword="account",
                    question="Connect the account?",
                    purpose="account_setup",
                ),
                TaskQuestionItem(
                    keyword="strategy",
                    question="How should online retailers be handled?",
                ),
            ]
        ),
    )


async def current(owner, task_id):
    return next(t for t in await tasks.list_workspace_tasks(owner) if t.id == task_id)


@pytest.mark.asyncio
async def test_recipient_is_independent_and_mixed_answers_resume_once(owner):
    task = await asking(owner)
    question_id = task.question.id
    routed = await tasks.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="route_question",
            version=task.version,
            question_id=question_id,
            question_keyword="strategy",
            question_target=EXPERT,
        ),
    )
    assert routed.assignee == REQUESTER
    assert routed.status == "needs_you"
    consult_id = routed.question.questions[1].consultation_task_id
    consult = await current(owner, consult_id)
    assert consult.assignee == EXPERT and consult.required is False
    assert consult.dispatch_state == "pending"
    reminder = await db.prisma.chatsession.find_unique(where={"id": task.session_id})
    assert reminder.metadata["pending_question"]["text"] == "Connect the account?"

    answered = await tasks.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="answer",
            version=1,
            question_id=question_id,
            answers={"account": "Use the existing connection"},
        ),
    )
    assert answered.question.answers is None
    assert (
        answered.status == "blocked" and answered.activity == "Waiting for Strategist"
    )
    reminder = await db.prisma.chatsession.find_unique(where={"id": task.session_id})
    assert "pending_question" not in reminder.metadata
    await tasks.workspace_task_run_event(owner, task.session_id, "finished")
    await tasks.claim_workspace_task_dispatch(owner, consult_id)
    await tasks.start_workspace_task_run(owner, consult.session_id, "consult-turn")
    await tasks.workspace_task_run_event(
        owner, consult.session_id, "result", "Search national retail directories"
    )
    resumed = await current(owner, task.id)
    assert resumed.assignee == REQUESTER
    assert resumed.question.answers == {
        "account": "Use the existing connection",
        "strategy": "Search national retail directories",
    }
    assert resumed.question.questions[1].answered_by == "Strategist"
    assert resumed.dispatch_state == "pending"
    assert "Answered by Strategist" in resumed.dispatch_message
    dispatch_id = resumed.dispatch_id
    await tasks.workspace_task_run_event(
        owner, consult.session_id, "result", "Duplicate late reply"
    )
    assert (await current(owner, task.id)).dispatch_id == dispatch_id
    assert not any(
        t.review_of == consult.id for t in await tasks.list_workspace_tasks(owner)
    )


@pytest.mark.asyncio
async def test_stale_consultation_cannot_answer_a_redirected_question(owner):
    task = await asking(owner)
    command = TaskCommand(
        operation="route_question",
        version=task.version,
        question_id=task.question.id,
        question_keyword="strategy",
        question_target=EXPERT,
    )
    task = await tasks.command_workspace_task(owner, task.id, command)
    old = await current(owner, task.question.questions[1].consultation_task_id)
    command.question_target = AUTO
    task = await tasks.command_workspace_task(owner, task.id, command)
    await tasks.workspace_task_run_event(
        owner, old.session_id, "result", "Old response"
    )
    saved = await current(owner, task.id)
    assert saved.question.questions[1].answer is None
    assert saved.question.questions[1].target == AUTO
    assert (await current(owner, old.id)).status == "canceled"


@pytest.mark.asyncio
async def test_approval_setup_and_other_users_are_not_delegatable(owner, monkeypatch):
    task = await asking(owner)
    command = TaskCommand(
        operation="route_question",
        version=task.version,
        question_id=task.question.id,
        question_keyword="account",
        question_target=EXPERT,
    )
    with pytest.raises(TaskConflict, match="stay with you"):
        await tasks.command_workspace_task(owner, task.id, command)
    with pytest.raises(NotFoundError):
        await tasks.command_workspace_task("different-user", task.id, command)
    monkeypatch.setattr(service, "task_assignees", AsyncMock(return_value=[AUTO]))
    with pytest.raises(NotFoundError, match="recipient"):
        await service.execute_task_command(owner, task.id, command)


@pytest.mark.asyncio
async def test_question_consultation_is_read_only_and_cannot_execute_under_hold(
    owner, monkeypatch
):
    task = await asking(owner)
    task = await tasks.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="route_question",
            version=task.version,
            question_id=task.question.id,
            question_keyword="strategy",
            question_target=EXPERT,
        ),
    )
    consultation = await current(owner, task.question.questions[1].consultation_task_id)
    session = ChatSession.new(user_id=owner, dry_run=False)
    session.session_id = consultation.session_id
    session.metadata = ChatSessionMetadata(workspace_task_id=consultation.id)
    monkeypatch.setattr(
        "backend.api.features.tasks.execution_policy.tasks_db", lambda: tasks
    )
    permissions, context = await task_execution_policy(
        session, None, "consult-read-only"
    )
    assert "read_workspace_file" in permissions.tools
    assert "write_workspace_file" not in permissions.tools
    assert "delegate_to_expert" not in permissions.tools
    assert "automatically" in context
    await tasks.workspace_task_run_event(owner, consultation.session_id, "finished")
    await tasks.workspace_task_run_event(owner, task.session_id, "finished")
    await tasks.command_workspace_task(
        owner,
        task.id,
        TaskCommand(operation="hold", version=(await current(owner, task.id)).version),
    )
    authority = await tasks.start_workspace_task_run(
        owner, consultation.session_id, "stale-consult"
    )
    assert not authority.can_execute


def test_self_questions_and_handoff_loops_are_refused():
    source = WorkspaceTask(
        user_id="user",
        title="Work",
        assignee=EXPERT,
        question=TaskQuestion(
            questions=[TaskQuestionItem(keyword="q", question="Advice?", target=EXPERT)]
        ),
    )
    with pytest.raises(TaskConflict, match="owner"):
        prepare_question_tasks(source, [source])
    source.question.questions[0].target = AUTO
    all_tasks = [source]
    prepare_question_tasks(source, all_tasks)
    consultation = all_tasks[-1]
    consultation.question = TaskQuestion(
        questions=[TaskQuestionItem(keyword="q2", question="Ask back?", target=EXPERT)]
    )
    prepare_question_tasks(consultation, all_tasks)
    returned = all_tasks[-1]
    returned.question = TaskQuestion(
        questions=[TaskQuestionItem(keyword="q3", question="Loop?", target=AUTO)]
    )
    with pytest.raises(TaskConflict, match="waiting"):
        prepare_question_tasks(returned, all_tasks)
    refresh_question_state(source)
    assert source.activity == "Waiting for AutoPilot"


@pytest.mark.asyncio
async def test_agent_targets_each_question_even_when_keywords_repeat(
    owner, monkeypatch
):
    from backend.copilot.tools import ask_question

    task = await asking(owner)
    session = ChatSession.new(user_id=owner, dry_run=False)
    session.session_id = task.session_id
    session.metadata = ChatSessionMetadata(workspace_task_id=task.id)
    monkeypatch.setattr(ask_question, "tasks_db", lambda: tasks)
    monkeypatch.setattr(
        service, "task_assignees", AsyncMock(return_value=[EXPERT, AUTO])
    )
    result = await ask_question.AskQuestionTool()._execute(
        user_id=owner,
        session=session,
        questions=[
            {
                "question": "Which segment strategy?",
                "keyword": "advice",
                "target_kind": "expert",
                "target_id": EXPERT.id,
            },
            {
                "question": "Which project priority?",
                "keyword": "advice",
                "target_kind": "auto",
            },
        ],
    )
    saved = await current(owner, task.id)
    assert [q.target for q in saved.question.questions] == [EXPERT, AUTO]
    assert [q.keyword for q in result.questions] == ["advice", "advice-1"]
    assert session.metadata.pending_question is None
    assert saved.status == "blocked"
