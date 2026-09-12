import asyncio
import os

import pytest

from backend.api.features.tasks import db
from backend.api.features.tasks.domain import TaskConflict, progress
from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskBreakdownAccept,
    TaskBreakdownRequest,
    TaskBreakdownSelection,
    TaskBreakdownStep,
    TaskCommand,
    TaskCreate,
)

pytestmark = pytest.mark.skipif(
    not os.getenv("TASKS_TEST_DATABASE"), reason="Requires isolated task test database"
)
AUTO = TaskAssignee(kind="auto", id="auto", name="AutoPilot")


async def ready_preview(owner, task):
    started = await db.begin_workspace_task_breakdown(
        owner, task.id, TaskBreakdownRequest()
    )
    assert started.breakdown
    first = TaskBreakdownStep(title="Choose the kit contents", suggestion=AUTO)
    second = TaskBreakdownStep(
        title="Design the grid", suggestion=AUTO, dependencies=[first.id]
    )
    await db.finish_workspace_task_breakdown(
        owner, task.id, started.breakdown.id, [first, second]
    )
    request = TaskBreakdownAccept(
        preview_id=started.breakdown.id,
        steps=[
            TaskBreakdownSelection(
                id=step.id, title=step.title, assignee=step.suggestion
            )
            for step in (first, second)
        ],
    )
    return first, second, request


@pytest.mark.asyncio
async def test_suggestion_completion_never_invalidates_or_overwrites_explicit_assignment(
    owner,
):
    task = await db.create_workspace_task(owner, TaskCreate(title="Sample kits"))
    started = await db.begin_workspace_task_suggestion(owner, task.id)
    assert started and started.version == task.version
    await asyncio.gather(
        db.finish_workspace_task_suggestion(
            owner, task.id, started.suggestion_request_id, AUTO, []
        ),
        db.command_workspace_task(
            owner,
            task.id,
            TaskCommand(
                operation="assign",
                version=task.version,
                assignee=TaskAssignee(kind="human", id=owner, name="You"),
            ),
        ),
    )
    current = (await db.list_workspace_tasks(owner))[0]
    assert current.assignee.kind == "human" and current.suggestion is None
    assert current.dispatch_state is None


@pytest.mark.asyncio
async def test_preview_and_accepting_undelegated_scope_do_not_start_execution(owner):
    task = await db.create_workspace_task(owner, TaskCreate(title="Sample kits"))
    first, second, request = await ready_preview(owner, task)
    assert len(await db.list_workspace_tasks(owner)) == 1
    await db.accept_workspace_task_breakdown(owner, task.id, request)
    await db.accept_workspace_task_breakdown(owner, task.id, request)
    tasks = await db.list_workspace_tasks(owner)
    assert len(tasks) == 3
    assert all(t.dispatch_id is None and t.assignee is None for t in tasks)
    children = {t.id: t for t in tasks if t.parent_id == task.id}
    assert children[first.id].suggestion.id == "auto"
    assert children[second.id].dependencies == [first.id]


@pytest.mark.asyncio
@pytest.mark.parametrize("held", [False, True])
async def test_delegated_preview_keeps_coordinator_and_waits_for_dependencies_and_holds(
    owner, held
):
    task = await db.create_workspace_task(
        owner, TaskCreate(title="Sample kits", plan_only=held)
    )
    task = await db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(operation="assign", version=task.version, assignee=AUTO),
    )
    first, second, request = await ready_preview(owner, task)
    await db.accept_workspace_task_breakdown(owner, task.id, request)
    tasks = {t.id: t for t in await db.list_workspace_tasks(owner)}
    assert tasks[task.id].assignee == AUTO
    assert tasks[first.id].assignee == AUTO and tasks[second.id].assignee == AUTO
    assert tasks[first.id].dispatch_state == (None if held else "pending")
    assert tasks[second.id].dispatch_state is None


@pytest.mark.asyncio
async def test_breakdown_preserves_completed_leaf_and_rejects_dropped_prerequisite(
    owner,
):
    task = await db.create_workspace_task(owner, TaskCreate(title="Sample kits"))
    task = await db.command_workspace_task(
        owner, task.id, TaskCommand(operation="complete", version=task.version)
    )
    first, second, request = await ready_preview(owner, task)
    with pytest.raises(TaskConflict, match="prerequisite"):
        await db.accept_workspace_task_breakdown(
            owner, task.id, request.model_copy(update={"steps": request.steps[1:]})
        )
    assert len(await db.list_workspace_tasks(owner)) == 1
    await db.accept_workspace_task_breakdown(owner, task.id, request)
    tasks = await db.list_workspace_tasks(owner)
    preserved = next(t for t in tasks if t.status == "done")
    assert preserved.parent_id == task.id and preserved.events == task.events
    assert progress(task.id, tasks) == (1, 3)


@pytest.mark.asyncio
async def test_changing_parent_context_invalidates_late_recommendations_and_previews(
    owner,
):
    parent = await db.create_workspace_task(owner, TaskCreate(title="Work"))
    child = await db.create_workspace_task(
        owner, TaskCreate(title="Select kit contents", parent_id=parent.id)
    )
    started = await db.begin_workspace_task_suggestion(owner, child.id)
    _, _, request = await ready_preview(owner, child)
    await db.command_workspace_task(
        owner,
        parent.id,
        TaskCommand(
            operation="edit",
            version=parent.version,
            project="Needlepoint business",
            description="Choose products from order history",
        ),
    )
    await db.finish_workspace_task_suggestion(
        owner, child.id, started.suggestion_request_id, AUTO, []
    )
    current = next(t for t in await db.list_workspace_tasks(owner) if t.id == child.id)
    assert current.suggestion is None and current.suggestion_state == "idle"
    with pytest.raises(TaskConflict, match="changed"):
        await db.accept_workspace_task_breakdown(owner, child.id, request)
    assert len(await db.list_workspace_tasks(owner)) == 2


@pytest.mark.asyncio
async def test_decomposition_preserves_the_original_result_chat_and_review(owner):
    task = await db.create_workspace_task(owner, TaskCreate(title="Sample kits"))
    task = await db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(operation="assign", version=task.version, assignee=AUTO),
    )
    assert task.session_id
    session_id = task.session_id
    await db.workspace_task_run_event(owner, session_id, "started")
    await db.workspace_task_run_event(
        owner, session_id, "result", "The first prototype is ready"
    )
    task = await db.workspace_task_run_event(owner, session_id, "finished")
    assert task and task.result
    _, _, request = await ready_preview(owner, task)
    await db.accept_workspace_task_breakdown(owner, task.id, request)
    tasks = await db.list_workspace_tasks(owner)
    original = await db.workspace_task_for_session(owner, session_id)
    assert original and original.id != task.id and original.parent_id == task.id
    assert (
        original.result == "The first prototype is ready"
        and original.status == "needs_you"
    )
    review = next(item for item in tasks if item.review_of)
    assert review.review_of == original.id
    parent = next(item for item in tasks if item.id == task.id)
    assert parent.result is None and parent.assignee == AUTO


@pytest.mark.asyncio
async def test_coordinator_can_delegate_existing_planned_steps_without_duplicating_or_reassigning(
    owner,
):
    task = await db.create_workspace_task(owner, TaskCreate(title="Sample kits"))
    first, second, request = await ready_preview(owner, task)
    task = await db.accept_workspace_task_breakdown(owner, task.id, request)
    task = await db.command_workspace_task(
        owner,
        task.id,
        TaskCommand(operation="assign", version=task.version, assignee=AUTO),
    )
    assert task.session_id
    child = await db.assign_workspace_task_step(owner, task.session_id, first.id, AUTO)
    assert child.id == first.id and child.dispatch_state == "pending"
    await db.assign_workspace_task_step(owner, task.session_id, first.id, AUTO)
    with pytest.raises(TaskConflict, match="confirmed owner"):
        await db.assign_workspace_task_step(
            owner,
            task.session_id,
            first.id,
            TaskAssignee(kind="human", id=owner, name="You"),
        )
    current = await db.list_workspace_tasks(owner)
    assert len(current) == 3
    assert [item.id for item in current if item.parent_id == task.id] == [
        first.id,
        second.id,
    ]
    outside = await db.create_workspace_task(
        owner, TaskCreate(title="Separate outcome")
    )
    with pytest.raises(TaskConflict, match="within this outcome"):
        await db.assign_workspace_task_step(owner, task.session_id, outside.id, AUTO)


@pytest.mark.asyncio
async def test_opening_child_chat_cannot_bypass_an_outcome_dependency(owner):
    prerequisite = await db.create_workspace_task(
        owner, TaskCreate(title="Approve the assortment")
    )
    parent = await db.create_workspace_task(
        owner, TaskCreate(title="Manufacture the kits")
    )
    parent = await db.command_workspace_task(
        owner,
        parent.id,
        TaskCommand(
            operation="edit", version=parent.version, dependencies=[prerequisite.id]
        ),
    )
    child = await db.create_workspace_task(
        owner, TaskCreate(title="Print grids", parent_id=parent.id)
    )
    child = await db.command_workspace_task(
        owner,
        child.id,
        TaskCommand(operation="assign", version=child.version, assignee=AUTO),
    )
    child = await db.bind_workspace_task_session(owner, child.id)
    assert child.session_id
    authority = await db.start_workspace_task_run(
        owner, child.session_id, "before-prerequisite"
    )
    assert not authority.can_execute
    await db.command_workspace_task(
        owner,
        prerequisite.id,
        TaskCommand(operation="complete", version=prerequisite.version),
    )
    authority = await db.start_workspace_task_run(
        owner, child.session_id, "after-prerequisite"
    )
    assert authority.can_execute


@pytest.mark.asyncio
async def test_coordinator_cannot_present_an_unfinished_plan_as_the_final_outcome(
    owner,
):
    parent = await db.create_workspace_task(
        owner, TaskCreate(title="Launch the starter pack")
    )
    child = await db.create_workspace_task(
        owner, TaskCreate(title="Choose components", parent_id=parent.id)
    )
    parent = await db.command_workspace_task(
        owner,
        parent.id,
        TaskCommand(operation="assign", version=parent.version, assignee=AUTO),
    )
    assert parent.session_id
    await db.workspace_task_run_event(owner, parent.session_id, "started")
    with pytest.raises(TaskConflict, match="Required steps"):
        await db.workspace_task_run_event(
            owner, parent.session_id, "result", "Here is the plan"
        )
    tasks = await db.list_workspace_tasks(owner)
    assert len(tasks) == 2 and all(not item.review_of for item in tasks)
    await db.command_workspace_task(
        owner, child.id, TaskCommand(operation="complete", version=child.version)
    )
    result = await db.workspace_task_run_event(
        owner, parent.session_id, "result", "The required work is accepted"
    )
    assert result and result.result == "The required work is accepted"


@pytest.mark.asyncio
async def test_regular_chat_can_nest_by_parent_id_without_inheriting_execution_authority(
    owner,
):
    from datetime import UTC, datetime

    from backend.copilot.model import ChatSession
    from backend.copilot.tools.manage_tasks import ManageTasksTool

    parent = await db.create_workspace_task(owner, TaskCreate(title="SO-101 project"))
    parent = await db.command_workspace_task(
        owner,
        parent.id,
        TaskCommand(operation="assign", version=parent.version, assignee=AUTO),
    )
    session = ChatSession(
        session_id="regular-chat",
        user_id=owner,
        started_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        usage=[],
        messages=[],
    )
    result = await ManageTasksTool()._execute(
        owner,
        session,
        operation="add_step",
        task_id=parent.id,
        title="Set up the robot",
        description="A genuine nested step",
        assignee_kind="auto",
        assignee_id="auto",
    )
    child = result.tasks[0]
    assert child.parent_id == parent.id
    assert child.assignee is None and child.suggestion.id == "auto"
    assert child.dispatch_id is None
    repeated = await db.add_workspace_task_step(
        owner,
        session.session_id,
        child.title,
        child.description,
        AUTO,
        parent_id=parent.id,
    )
    assert repeated.id == child.id
    with pytest.raises(TaskConflict, match="not found"):
        await db.add_workspace_task_step(
            owner,
            session.session_id,
            "Wrong parent",
            "",
            parent_id="another-users-task",
        )
    grandchild = await db.add_workspace_task_step(
        owner, session.session_id, "Check the joint layout", "", parent_id=child.id
    )
    assert grandchild.parent_id == child.id and grandchild.dispatch_id is None
    listed = await ManageTasksTool()._execute(
        owner, session, operation="list", task_id=parent.id
    )
    assert {item.id for item in listed.tasks} == {parent.id, child.id, grandchild.id}


@pytest.mark.asyncio
async def test_refinement_keeps_edited_deliverables_and_validates_its_source_preview(
    owner,
):
    task = await db.create_workspace_task(
        owner, TaskCreate(title="Prepare sample kits")
    )
    first, second, acceptance = await ready_preview(owner, task)
    edited = [
        step.model_copy(update={"description": "Edited deliverable from the preview"})
        for step in acceptance.steps
    ]
    with pytest.raises(TaskConflict, match="preview changed"):
        await db.begin_workspace_task_breakdown(
            owner,
            task.id,
            TaskBreakdownRequest(preview_id="stale", current_steps=edited),
        )
    with pytest.raises(TaskConflict, match="prerequisite"):
        await db.begin_workspace_task_breakdown(
            owner,
            task.id,
            TaskBreakdownRequest(
                preview_id=acceptance.preview_id, current_steps=edited[1:]
            ),
        )
    pending = await db.begin_workspace_task_breakdown(
        owner,
        task.id,
        TaskBreakdownRequest(
            preview_id=acceptance.preview_id,
            current_steps=edited,
            guidance="Make a first batch of 50 kits",
        ),
    )
    assert pending.breakdown.state == "pending"
    assert all(
        step.description == "Edited deliverable from the preview"
        for step in pending.breakdown.steps
    )
    assert pending.breakdown.steps[1].dependencies == [first.id]
    assert len(await db.list_workspace_tasks(owner)) == 1
    await db.finish_workspace_task_breakdown(
        owner, task.id, pending.breakdown.id, [], "Temporary model failure"
    )
    failed = (await db.list_workspace_tasks(owner))[0]
    assert (
        failed.breakdown.state == "error"
        and failed.breakdown.steps == pending.breakdown.steps
    )
    pending = await db.begin_workspace_task_breakdown(
        owner,
        task.id,
        TaskBreakdownRequest(
            preview_id=failed.breakdown.id,
            current_steps=edited,
            guidance=failed.breakdown.guidance,
        ),
    )
    await db.finish_workspace_task_breakdown(
        owner, task.id, pending.breakdown.id, pending.breakdown.steps
    )
    acceptance.preview_id = pending.breakdown.id
    acceptance.steps = edited
    acceptance.steps[0].description = (
        "Final deliverable: reviewed list of 50 kit contents"
    )
    await db.accept_workspace_task_breakdown(owner, task.id, acceptance)
    saved = {item.id: item for item in await db.list_workspace_tasks(owner)}
    assert (
        saved[first.id].description
        == "Final deliverable: reviewed list of 50 kit contents"
    )
    assert saved[second.id].description == "Edited deliverable from the preview"
    assert saved[second.id].dependencies == [first.id]
