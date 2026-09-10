import asyncio
import os

import pytest

from backend.api.features.tasks import db as task_db
from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskCommand,
    TaskCreate,
    TaskSchedule,
)

pytestmark = pytest.mark.skipif(
    not os.getenv("TASKS_TEST_DATABASE"), reason="Requires isolated task test database"
)


@pytest.mark.asyncio
async def test_recurring_occurrences_are_idempotent_and_complete_independently(owner):
    template = await task_db.create_workspace_task(
        owner, TaskCreate(title="Review the week")
    )
    template = await task_db.command_workspace_task(
        owner,
        template.id,
        TaskCommand(
            operation="assign",
            version=template.version,
            assignee=TaskAssignee(kind="human", id=owner, name="You"),
        ),
    )
    template = await task_db.configure_workspace_task_schedule(
        owner,
        template.id,
        template.version,
        TaskSchedule(cron="0 9 * * 1", timezone="America/Chicago"),
    )
    assert template.schedule and template.schedule.id
    occurrences = await asyncio.gather(
        *[
            task_db.create_workspace_task_occurrence(
                owner, template.id, template.schedule.id, "2026-09-14T14:00:00Z"
            )
            for _ in range(2)
        ]
    )
    first, repeated = occurrences
    assert first and repeated and first.id == repeated.id
    await task_db.command_workspace_task(
        owner, first.id, TaskCommand(operation="complete", version=first.version)
    )
    following = await task_db.create_workspace_task_occurrence(
        owner, template.id, template.schedule.id, "2026-09-21T14:00:00Z"
    )
    assert following and following.id != first.id and following.status == "todo"
    template = next(
        t for t in await task_db.list_workspace_tasks(owner) if t.id == template.id
    )
    assert template.status == "todo"
    assert template.schedule
    template.schedule.paused = True
    template = await task_db.configure_workspace_task_schedule(
        owner, template.id, template.version, template.schedule
    )
    assert (
        await task_db.create_workspace_task_occurrence(
            owner, template.id, template.schedule.id, "2026-09-28T14:00:00Z"
        )
        is None
    )


@pytest.mark.asyncio
async def test_standing_delegation_carries_to_an_occurrence_without_running_template(
    owner,
):
    template = await task_db.create_workspace_task(
        owner, TaskCreate(title="Daily research", plan_only=True)
    )
    template = await task_db.command_workspace_task(
        owner,
        template.id,
        TaskCommand(
            operation="assign",
            version=template.version,
            assignee=TaskAssignee(kind="auto", id="auto", name="Auto"),
        ),
    )
    template = await task_db.configure_workspace_task_schedule(
        owner, template.id, template.version, TaskSchedule(cron="0 9 * * *")
    )
    template = await task_db.command_workspace_task(
        owner, template.id, TaskCommand(operation="activate", version=template.version)
    )
    assert (
        template.dispatch_state is None and template.schedule and template.schedule.id
    )
    occurrence = await task_db.create_workspace_task_occurrence(
        owner, template.id, template.schedule.id, "2026-09-11T09:00:00Z"
    )
    assert occurrence and occurrence.assignee == template.assignee
    assert occurrence.dispatch_state == "pending"
