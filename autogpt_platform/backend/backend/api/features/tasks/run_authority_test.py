import os

import pytest

from backend.api.features.tasks import db as task_db
from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.models import TaskAssignee, TaskCommand, TaskCreate

pytestmark = pytest.mark.skipif(
    not os.getenv("TASKS_TEST_DATABASE"), reason="Requires isolated task test database"
)


@pytest.mark.asyncio
async def test_start_fences_reassignment_and_replayed_turns(owner):
    task = await task_db.create_workspace_task(
        owner, TaskCreate(title="Compare suppliers")
    )
    task = await task_db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="assign",
            version=task.version,
            assignee=TaskAssignee(kind="auto", id="auto", name="Auto"),
        ),
    )
    assert task.session_id
    first = await task_db.start_workspace_task_run(owner, task.session_id, "turn-1")
    assert first.can_execute and first.task
    with pytest.raises(TaskConflict):
        await task_db.command_workspace_task(
            owner,
            task.id,
            TaskCommand(operation="assign", version=first.task.version, assignee=None),
        )
    repeated = await task_db.start_workspace_task_run(owner, task.session_id, "turn-1")
    assert repeated.duplicate_turn and not repeated.can_execute
    failed = await task_db.workspace_task_run_event(
        owner, task.session_id, "finished", "Try again", turn_id="turn-1"
    )
    assert failed
    await task_db.command_workspace_task(
        owner, task.id, TaskCommand(operation="retry", version=failed.version)
    )
    second = await task_db.start_workspace_task_run(owner, task.session_id, "turn-2")
    assert second.can_execute
    stale = await task_db.workspace_task_run_event(
        owner, task.session_id, "finished", "Old attempt failed", turn_id="turn-1"
    )
    assert stale and stale.status == "working" and stale.last_turn_id == "turn-2"
    assert (
        await task_db.start_workspace_task_run(owner, task.session_id, "turn-1")
    ).duplicate_turn
