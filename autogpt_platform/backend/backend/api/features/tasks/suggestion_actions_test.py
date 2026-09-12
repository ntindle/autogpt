import os

import pytest

from backend.api.features.tasks import db as task_db
from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.models import TaskAssignee, TaskCommand, TaskCreate

pytestmark = pytest.mark.skipif(
    not os.getenv("TASKS_TEST_DATABASE"), reason="Requires isolated task database"
)
AUTO = TaskAssignee(kind="auto", id="auto", name="AutoPilot")


async def suggested_task(owner):
    task = await task_db.create_workspace_task(
        owner, TaskCreate(title="Prepare the sample kit", plan_only=True)
    )
    pending = await task_db.begin_workspace_task_suggestion(owner, task.id)
    await task_db.finish_workspace_task_suggestion(
        owner, task.id, pending.suggestion_request_id, AUTO, []
    )
    return (await task_db.list_workspace_tasks(owner))[0]


@pytest.mark.asyncio
async def test_dismissal_survives_refresh_and_ignores_late_model_results(owner):
    task = await suggested_task(owner)
    dismissed = await task_db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="dismiss_suggestion",
            version=task.version,
            suggestion_request_id=task.suggestion_request_id,
        ),
    )
    assert dismissed.assignee is None and dismissed.suggestion is None
    assert dismissed.plan_only and dismissed.dispatch_state is None
    assert dismissed.version == task.version + 1
    assert await task_db.begin_workspace_task_suggestion(owner, task.id) is None
    assert await task_db.reconsider_workspace_task_plans(owner) == []
    await task_db.finish_workspace_task_suggestion(
        owner, task.id, task.suggestion_request_id, AUTO, []
    )
    assert (await task_db.list_workspace_tasks(owner))[0].suggestion is None
    forced = await task_db.begin_workspace_task_suggestion(owner, task.id, force=True)
    assert forced and forced.suggestion_request_id != task.suggestion_request_id


@pytest.mark.asyncio
async def test_dismissal_does_not_suppress_changed_context_or_replace_an_owner(owner):
    task = await suggested_task(owner)
    dismissed = await task_db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="dismiss_suggestion",
            version=task.version,
            suggestion_request_id=task.suggestion_request_id,
        ),
    )
    edited = await task_db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="edit",
            version=dismissed.version,
            description="Include a printable cutting guide",
        ),
    )
    jobs = await task_db.reconsider_workspace_task_plans(owner)
    assert len(jobs) == 1 and jobs[0].owner
    assigned = await task_db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(operation="assign", version=edited.version, assignee=AUTO),
    )
    with pytest.raises(TaskConflict, match="suggestion"):
        await task_db.command_workspace_task(
            owner,
            task.id,
            TaskCommand(
                operation="dismiss_suggestion",
                version=assigned.version,
                suggestion_request_id=task.suggestion_request_id,
            ),
        )
    assert (await task_db.list_workspace_tasks(owner))[0].assignee == AUTO


@pytest.mark.asyncio
async def test_stale_suggestion_cannot_dismiss_a_replacement(owner):
    task = await suggested_task(owner)
    replacement = await task_db.begin_workspace_task_suggestion(
        owner, task.id, force=True
    )
    await task_db.finish_workspace_task_suggestion(
        owner, task.id, replacement.suggestion_request_id, AUTO, []
    )
    with pytest.raises(TaskConflict, match="suggestion changed"):
        await task_db.command_workspace_task(
            owner,
            task.id,
            TaskCommand(
                operation="dismiss_suggestion",
                version=task.version,
                suggestion_request_id=task.suggestion_request_id,
            ),
        )
    assert (await task_db.list_workspace_tasks(owner))[0].suggestion == AUTO


@pytest.mark.asyncio
async def test_legacy_chat_suggestion_dismissal_is_durable(owner):
    task = await task_db.create_workspace_task(
        owner, TaskCreate(title="A legacy suggestion")
    )
    task = await task_db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(operation="suggest", version=task.version, assignee=AUTO),
    )
    assert not task.suggestion_request_id and not task.suggestion_context
    dismissed = await task_db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(
            operation="dismiss_suggestion",
            version=task.version,
            suggestion_request_id="",
        ),
    )
    assert dismissed.suggestion is None and dismissed.suggestion_context
    assert await task_db.reconsider_workspace_task_plans(owner) == []
