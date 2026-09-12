from uuid import NAMESPACE_URL, uuid5

from backend.api.features.experts import experts_db
from backend.api.features.tasks.commands import apply_command
from backend.api.features.tasks.domain import (
    TaskConflict,
    branch,
    check_structure,
    record,
)
from backend.api.features.tasks.models import TaskAssignee, TaskCommand, WorkspaceTask
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
    dependencies: list[str] | None = None,
    parent_id: str | None = None,
) -> WorkspaceTask:
    assignee = await _eligible_assignee(user_id, assignee)
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        linked = next((t for t in tasks if t.session_id == session_id), None)
        root = (
            next((t for t in tasks if t.id == parent_id), None) if parent_id else linked
        )
        if root is None:
            raise TaskConflict(
                "Parent task not found in your workspace"
                if parent_id
                else "Provide a parent task ID or use a task-linked conversation"
            )
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
        delegated = bool(
            linked
            and linked.assignee
            and linked.assignee.kind != "human"
            and linked.accepted
            and root.id in {item.id for item in branch(linked.id, tasks)}
            and root.assignee is not None
            and root.assignee.kind != "human"
            and root.accepted
        )
        prerequisite_ids = {
            item.id for item in tasks if not item.schedule and not item.review_of
        }
        if any(dependency not in prerequisite_ids for dependency in dependencies or []):
            raise TaskConflict(
                "Dependencies must reference existing tasks in your workspace, not schedules or review items"
            )
        task = WorkspaceTask(
            id=task_id,
            user_id=user_id,
            source_session_id=session_id,
            organization_id=root.organization_id,
            title=title,
            description=description,
            project=root.project,
            parent_id=root.id,
            accepted=not proposed,
            assignee=assignee if delegated and not proposed else None,
            suggestion=assignee if not delegated or proposed else None,
            suggestion_state=(
                "ready" if assignee and (not delegated or proposed) else "idle"
            ),
            dependencies=dependencies or [],
        )
        record(
            task,
            (
                linked.assignee.name
                if delegated and linked and linked.assignee
                else user_id
            ),
            (
                "Proposed new scope"
                if proposed
                else "Added a necessary step within this outcome"
            ),
        )
        tasks.append(task)
        check_structure(task, tasks)
        if delegated:
            _prepare_dispatches(tasks)
        await _save(tx, task)
        return task


async def _eligible_assignee(
    user_id: str, assignee: TaskAssignee | None
) -> TaskAssignee | None:
    if assignee and assignee.kind == "expert":
        expert = await experts_db.get_expert(user_id, assignee.id)
        if not expert or expert.is_archived or expert.schedules_paused_at:
            raise TaskConflict("Expert is not available for this work")
        assignee = TaskAssignee(
            kind="expert",
            id=expert.id,
            name=expert.name,
            avatar_url=expert.avatar_url,
            color=expert.color,
            role=expert.role,
        )
    if assignee and assignee.kind == "human" and assignee.id != user_id:
        raise TaskConflict("This person is not an eligible assignee")
    return assignee


async def assign_workspace_task_step(
    user_id: str, session_id: str, task_id: str, assignee: TaskAssignee
) -> WorkspaceTask:
    canonical = await _eligible_assignee(user_id, assignee)
    if canonical is None:
        raise TaskConflict("Choose an eligible assignee")
    assignee = canonical
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        root = next((t for t in tasks if t.session_id == session_id), None)
        if (
            not root
            or not root.assignee
            or root.assignee.kind == "human"
            or not root.accepted
            or root.status in ("done", "canceled")
        ):
            raise TaskConflict("Only a delegated outcome can assign its steps")
        target = next(
            (t for t in branch(root.id, tasks) if t.id == task_id and t.id != root.id),
            None,
        )
        if (
            not target
            or not target.accepted
            or target.review_of
            or target.status in ("done", "canceled")
        ):
            raise TaskConflict(
                "Choose an accepted, unfinished step within this outcome"
            )
        if target.assignee:
            if assignee and (target.assignee.kind, target.assignee.id) == (
                assignee.kind,
                assignee.id,
            ):
                return target
            raise TaskConflict(
                "This step already has a confirmed owner; preserve that assignment"
            )
        apply_command(
            target,
            TaskCommand(operation="assign", version=target.version, assignee=assignee),
            tasks,
            actor=root.assignee.name,
        )
        _prepare_dispatches(tasks)
        for changed in tasks:
            await _save(tx, changed)
        return target
