from datetime import UTC, datetime

from backend.api.features.tasks.models import TaskEvent, WorkspaceTask


class TaskConflict(ValueError):
    pass


def branch(task_id: str, tasks: list[WorkspaceTask]) -> list[WorkspaceTask]:
    ids = {task_id}
    for _ in range(len(tasks)):
        added = {t.id for t in tasks if t.parent_id in ids} - ids
        if not added:
            break
        ids.update(added)
    return [t for t in tasks if t.id in ids]


def ancestors(task: WorkspaceTask, tasks: list[WorkspaceTask]) -> list[WorkspaceTask]:
    by_id = {t.id: t for t in tasks}
    result = [task]
    seen = {task.id}
    while result[-1].parent_id:
        parent = by_id.get(result[-1].parent_id)
        if parent is None or parent.id in seen:
            raise TaskConflict("Invalid task hierarchy")
        result.append(parent)
        seen.add(parent.id)
    return result


def is_runnable(task: WorkspaceTask, tasks: list[WorkspaceTask]) -> bool:
    if not task.assignee or task.assignee.kind == "human" or task.schedule:
        return False
    if (
        task.status != "todo"
        and not (task.status == "blocked" and task.dispatch_state is None)
    ) or task.dispatch_state in ("claimed", "sent"):
        return False
    if any(
        t.plan_only or t.paused or not t.accepted or t.status == "canceled"
        for t in ancestors(task, tasks)
    ):
        return False
    by_id = {t.id: t for t in tasks}
    return all(
        d in by_id and by_id[d].status == "done"
        for item in ancestors(task, tasks)
        for d in item.dependencies
    )


def progress(task_id: str, tasks: list[WorkspaceTask]) -> tuple[int, int]:
    scoped = branch(task_id, tasks)
    scoped_ids = {item.id for item in scoped}
    members = [
        t
        for t in scoped
        if all(
            item.accepted
            and item.required
            and item.status != "canceled"
            and not item.schedule
            for item in ancestors(t, tasks)
            if item.id in scoped_ids
        )
    ]
    parent_ids = {t.parent_id for t in members}
    leaves = [t for t in members if t.id not in parent_ids]
    return sum(t.status == "done" for t in leaves), len(leaves)


def record(task: WorkspaceTask, actor: str, text: str) -> None:
    task.events.append(TaskEvent(actor=actor, text=text))
    task.updated_at = datetime.now(UTC)
    task.version += 1


def check_structure(task: WorkspaceTask, tasks: list[WorkspaceTask]) -> None:
    ancestors(task, tasks)
    by_id = {t.id: t for t in tasks}
    seen: set[str] = set()
    checked: set[str] = set()

    def visit(task_id: str) -> None:
        if task_id in checked:
            return
        if task_id in seen:
            raise TaskConflict("Tasks cannot depend on themselves or form a cycle")
        seen.add(task_id)
        item = by_id.get(task_id)
        if item is None:
            raise TaskConflict("Dependency not found")
        for dependency in {
            d for parent in ancestors(item, tasks) for d in parent.dependencies
        }:
            if dependency in {t.id for t in ancestors(item, tasks)} or dependency in {
                t.id for t in branch(item.id, tasks)
            }:
                raise TaskConflict(
                    "A task cannot depend on its parent outcome or its own steps"
                )
            visit(dependency)
        seen.remove(task_id)
        checked.add(task_id)

    visit(task.id)


def can_edit_execution(task: WorkspaceTask) -> None:
    if task.dispatch_state in ("claimed", "sent") or task.status == "working":
        raise TaskConflict(
            "Stop the active attempt before changing its assignment or scope"
        )
