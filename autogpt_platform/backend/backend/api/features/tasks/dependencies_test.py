import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from backend.api.features.tasks import db as task_db
from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.models import TaskAssignee, TaskCommand, TaskCreate
from backend.copilot.model import ChatSession
from backend.copilot.tools.manage_tasks import ManageTasksTool, WorkspaceTasksResponse
from backend.copilot.tools.models import ErrorResponse
from backend.data import db

pytestmark = pytest.mark.skipif(
    not os.getenv("TASKS_TEST_DATABASE"), reason="Requires isolated task test database"
)


@pytest.mark.asyncio
async def test_cross_project_prerequisites_gate_nested_work_and_reject_cycles(owner):
    design = await task_db.create_workspace_task(
        owner, TaskCreate(title="Approve grid layout", project="Design")
    )
    materials = await task_db.create_workspace_task(
        owner, TaskCreate(title="Receive materials", project="Procurement")
    )
    website = await task_db.create_workspace_task(
        owner, TaskCreate(title="Publish sample kits", project="Website")
    )
    website = await task_db.command_workspace_task(
        owner,
        website.id,
        TaskCommand(
            operation="edit",
            version=website.version,
            dependencies=[design.id, materials.id],
        ),
    )
    child = await task_db.create_workspace_task(
        owner, TaskCreate(title="Write listing copy", parent_id=website.id)
    )
    child = await task_db.command_workspace_task(
        owner,
        child.id,
        TaskCommand(
            operation="assign",
            version=child.version,
            assignee=TaskAssignee(kind="auto", id="auto", name="AutoPilot"),
        ),
    )
    assert child.dispatch_state is None
    with pytest.raises(TaskConflict, match="cycle"):
        await task_db.command_workspace_task(
            owner,
            design.id,
            TaskCommand(
                operation="edit", version=design.version, dependencies=[child.id]
            ),
        )
    await task_db.command_workspace_task(
        owner, design.id, TaskCommand(operation="complete", version=design.version)
    )
    tasks = {task.id: task for task in await task_db.list_workspace_tasks(owner)}
    assert tasks[child.id].dispatch_state is None
    assert tasks[design.id].dependencies == []
    await task_db.command_workspace_task(
        owner,
        materials.id,
        TaskCommand(operation="complete", version=materials.version),
    )
    tasks = {task.id: task for task in await task_db.list_workspace_tasks(owner)}
    assert tasks[child.id].dispatch_state == "pending"
    assert tasks[website.id].dependencies == [design.id, materials.id]


@pytest.mark.asyncio
async def test_chat_can_find_and_link_owned_cross_project_work_without_gaining_authority(
    owner,
):
    prerequisite = await task_db.create_workspace_task(
        owner, TaskCreate(title="Approve parts", project="Procurement")
    )
    parent = await task_db.create_workspace_task(
        owner, TaskCreate(title="Launch kit", project="Website")
    )
    parent = await task_db.command_workspace_task(
        owner,
        parent.id,
        TaskCommand(
            operation="assign",
            version=parent.version,
            assignee=TaskAssignee(kind="auto", id="auto", name="AutoPilot"),
        ),
    )
    assert parent.session_id
    session = ChatSession(
        session_id=parent.session_id,
        user_id=owner,
        started_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        usage=[],
        messages=[],
    )
    tool = ManageTasksTool()
    scoped = await tool._execute(owner, session, operation="list")
    assert isinstance(scoped, WorkspaceTasksResponse)
    assert [task.id for task in scoped.tasks] == [parent.id]
    all_projects = await tool._execute(
        owner, session, operation="list", all_projects=True
    )
    assert isinstance(all_projects, WorkspaceTasksResponse)
    assert {task.id for task in all_projects.tasks} == {parent.id, prerequisite.id}
    other_project = await tool._execute(
        owner, session, operation="list", project="Procurement"
    )
    assert isinstance(other_project, WorkspaceTasksResponse)
    assert [task.id for task in other_project.tasks] == [prerequisite.id]
    result = await tool._execute(
        owner,
        session,
        operation="add_step",
        title="Describe approved parts",
        dependencies=[prerequisite.id],
        assignee_kind="auto",
        assignee_id="auto",
    )
    assert isinstance(result, WorkspaceTasksResponse)
    child = result.tasks[0]
    assert child.dependencies == [prerequisite.id]
    assert child.assignee and child.dispatch_state is None
    denied = await tool._execute(
        owner, session, operation="accept_result", task_id=prerequisite.id
    )
    assert isinstance(denied, ErrorResponse)
    await task_db.command_workspace_task(
        owner,
        prerequisite.id,
        TaskCommand(operation="complete", version=prerequisite.version),
    )
    tasks = {task.id: task for task in await task_db.list_workspace_tasks(owner)}
    assert tasks[child.id].dispatch_state == "pending"
    assert tasks[prerequisite.id].assignee is None


@pytest.mark.asyncio
async def test_cross_project_links_cannot_access_another_owners_task(owner):
    stranger = str(uuid4())
    await db.prisma.user.create(
        data={"id": stranger, "email": f"{stranger}@tasks.example.invalid"}
    )
    try:
        private = await task_db.create_workspace_task(
            stranger, TaskCreate(title="Private procurement", project="Procurement")
        )
        parent = await task_db.create_workspace_task(
            owner, TaskCreate(title="Publications", project="Website")
        )
        with pytest.raises(TaskConflict, match="workspace"):
            await task_db.add_workspace_task_step(
                owner,
                "regular-chat",
                "Wait for private work",
                "",
                parent_id=parent.id,
                dependencies=[private.id],
            )
        with pytest.raises(TaskConflict, match="Dependency not found"):
            await task_db.command_workspace_task(
                owner,
                parent.id,
                TaskCommand(
                    operation="edit", version=parent.version, dependencies=[private.id]
                ),
            )
        assert [task.id for task in await task_db.list_workspace_tasks(owner)] == [
            parent.id
        ]
    finally:
        await db.prisma.user.delete(where={"id": stranger})
