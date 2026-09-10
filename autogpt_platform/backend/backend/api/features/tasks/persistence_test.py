import asyncio
import os
from uuid import uuid4

import pytest
from prisma.errors import UniqueViolationError

from backend.api.features.tasks import db as task_db
from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskCommand,
    TaskCreate,
    TaskQuestion,
    TaskQuestionItem,
)
from backend.data import db
from backend.util.exceptions import NotFoundError

pytestmark = pytest.mark.skipif(
    not os.getenv("TASKS_TEST_DATABASE"), reason="Requires isolated task test database"
)


@pytest.mark.asyncio
async def test_capture_is_idempotent_and_cannot_overwrite_another_owner(owner):
    request = TaskCreate(title="Draft the launch")
    captured = await task_db.create_workspace_task(owner, request)
    assert captured.assignee is None
    assert captured.dispatch_id is None
    assert (await task_db.create_workspace_task(owner, request)).id == captured.id
    stranger = str(uuid4())
    await db.prisma.user.create(
        data={"id": stranger, "email": f"{stranger}@tasks.example.invalid"}
    )
    try:
        with pytest.raises(UniqueViolationError):
            await task_db.create_workspace_task(stranger, request)
        assert await task_db.list_workspace_tasks(stranger) == []
        with pytest.raises(NotFoundError):
            await task_db.command_workspace_task(
                stranger,
                captured.id,
                TaskCommand(operation="complete", version=captured.version),
            )
        assert (await task_db.list_workspace_tasks(owner))[0].title == captured.title
    finally:
        await db.prisma.user.delete(where={"id": stranger})


@pytest.mark.asyncio
async def test_concurrent_confirmation_produces_one_dispatch_claim(owner):
    task = await task_db.create_workspace_task(
        owner, TaskCreate(title="Research options")
    )
    command = TaskCommand(
        operation="assign",
        version=task.version,
        assignee=TaskAssignee(kind="auto", id="auto", name="Auto"),
    )
    outcomes = await asyncio.gather(
        task_db.command_workspace_task(owner, task.id, command),
        task_db.command_workspace_task(owner, task.id, command),
        return_exceptions=True,
    )
    assert sum(isinstance(outcome, TaskConflict) for outcome in outcomes) == 1
    current = (await task_db.list_workspace_tasks(owner))[0]
    assert current.dispatch_state == "pending"
    claims = await asyncio.gather(
        task_db.claim_workspace_task_dispatch(owner, task.id),
        task_db.claim_workspace_task_dispatch(owner, task.id),
    )
    assert sum(claim is not None for claim in claims) == 1


@pytest.mark.asyncio
async def test_stale_question_answer_rejected_and_result_needs_acceptance(owner):
    task = await task_db.create_workspace_task(
        owner, TaskCreate(title="Compare options")
    )
    assigned = await task_db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="assign",
            version=task.version,
            assignee=TaskAssignee(kind="auto", id="auto", name="Auto"),
        ),
    )
    session_id = assigned.session_id
    assert session_id
    await task_db.workspace_task_run_event(owner, session_id, "started")
    question = TaskQuestion(
        questions=[
            TaskQuestionItem(
                question="Which market?", keyword="market", options=["US", "EU"]
            )
        ]
    )
    asked = await task_db.workspace_task_run_event(
        owner, session_id, "question", question=question
    )
    assert asked
    with pytest.raises(TaskConflict):
        await task_db.command_workspace_task(
            owner,
            task.id,
            TaskCommand(
                operation="answer",
                version=asked.version,
                question_id="obsolete",
                answers={"market": "US"},
            ),
        )
    answered = await task_db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="answer",
            version=asked.version,
            question_id=question.id,
            answers={"market": "US"},
        ),
    )
    assert answered.question and answered.question.answered_by == owner
    with pytest.raises(TaskConflict):
        await task_db.command_workspace_task(
            owner,
            task.id,
            TaskCommand(
                operation="answer",
                version=answered.version,
                question_id=question.id,
                answers={"market": "US"},
            ),
        )
    await task_db.workspace_task_run_event(
        owner, session_id, "result", "Compared three vendors; see the attached report."
    )
    await task_db.workspace_task_run_event(owner, session_id, "finished")
    tasks = await task_db.list_workspace_tasks(owner)
    result = next(t for t in tasks if t.id == task.id)
    assert result.status == "needs_you"
    review = next(t for t in tasks if t.review_of == task.id)
    assert review.assignee and review.assignee.id == owner
    await task_db.command_workspace_task(
        owner, review.id, TaskCommand(operation="complete", version=review.version)
    )
    assert all(t.status == "done" for t in await task_db.list_workspace_tasks(owner))


@pytest.mark.asyncio
async def test_hold_preserves_assignment_and_dependency_completion_queues_work(owner):
    parent = await task_db.create_workspace_task(
        owner, TaskCreate(title="Launch", plan_only=True)
    )
    prerequisite = await task_db.create_workspace_task(
        owner, TaskCreate(title="Pick a market", parent_id=parent.id)
    )
    child = await task_db.create_workspace_task(
        owner, TaskCreate(title="Draft", parent_id=parent.id)
    )
    child = await task_db.command_workspace_task(
        owner,
        child.id,
        TaskCommand(
            operation="edit", version=child.version, dependencies=[prerequisite.id]
        ),
    )
    child = await task_db.command_workspace_task(
        owner,
        child.id,
        TaskCommand(
            operation="assign",
            version=child.version,
            assignee=TaskAssignee(kind="auto", id="auto", name="Auto"),
        ),
    )
    assert child.dispatch_state is None
    await task_db.command_workspace_task(
        owner, parent.id, TaskCommand(operation="activate", version=parent.version)
    )
    assert (
        next(
            t for t in await task_db.list_workspace_tasks(owner) if t.id == child.id
        ).dispatch_state
        is None
    )
    await task_db.command_workspace_task(
        owner,
        prerequisite.id,
        TaskCommand(operation="complete", version=prerequisite.version),
    )
    assert (
        next(
            t for t in await task_db.list_workspace_tasks(owner) if t.id == child.id
        ).dispatch_state
        == "pending"
    )
