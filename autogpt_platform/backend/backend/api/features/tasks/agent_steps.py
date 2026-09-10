from uuid import NAMESPACE_URL, uuid5

from backend.api.features.experts import experts_db
from backend.api.features.tasks.domain import TaskConflict, record
from backend.api.features.tasks.models import TaskAssignee, WorkspaceTask
from backend.api.features.tasks.repository import (
    _load,
    _lock,
    _prepare_dispatches,
    _save,
)
from backend.data.db import prisma


async def add_workspace_task_step(
    user_id: str,
    session_id: str,
    title: str,
    description: str,
    assignee: TaskAssignee | None = None,
    proposed: bool = False,
) -> WorkspaceTask:
    if assignee and assignee.kind == "expert":
        expert = await experts_db.get_expert(user_id, assignee.id)
        if not expert or expert.is_archived or expert.schedules_paused_at:
            raise TaskConflict("Expert is not available for this work")
        assignee = TaskAssignee(
            kind="expert", id=expert.id, name=expert.name, avatar_url=expert.avatar_url
        )
    if assignee and assignee.kind == "human" and assignee.id != user_id:
        raise TaskConflict("This person is not an eligible assignee")
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        root = next((t for t in tasks if t.session_id == session_id), None)
        if root is None:
            raise TaskConflict("No task is linked to this conversation")
        if root.status in ("done", "canceled"):
            raise TaskConflict("Reopen the outcome before adding more work")
        if len(tasks) >= 1000:
            raise TaskConflict("This workspace has reached 1,000 tasks")
        task_id = str(
            uuid5(NAMESPACE_URL, f"task-step:{root.id}:{title.strip().casefold()}")
        )
        existing = next((t for t in tasks if t.id == task_id), None)
        if existing:
            return existing
        delegated = (
            root.assignee is not None
            and root.assignee.kind != "human"
            and root.accepted
        )
        task = WorkspaceTask(
            id=task_id,
            user_id=user_id,
            organization_id=root.organization_id,
            title=title,
            description=description,
            project=root.project,
            parent_id=root.id,
            accepted=not proposed,
            assignee=assignee if delegated and not proposed else None,
            suggestion=assignee if not delegated or proposed else None,
        )
        record(
            task,
            root.assignee.name if root.assignee else "Auto",
            (
                "Proposed new scope"
                if proposed
                else "Added a necessary step within this outcome"
            ),
        )
        tasks.append(task)
        _prepare_dispatches(tasks)
        await _save(tx, task)
        return task
