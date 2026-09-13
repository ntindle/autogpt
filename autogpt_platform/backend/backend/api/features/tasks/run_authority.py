from pydantic import BaseModel

from backend.api.features.tasks.domain import ancestors, planning_hold, record
from backend.api.features.tasks.models import WorkspaceTask
from backend.api.features.tasks.repository import _load, _lock, _save
from backend.data.db import prisma


class TaskRunAuthority(BaseModel):
    task: WorkspaceTask | None = None
    can_execute: bool = False
    duplicate_turn: bool = False


async def start_workspace_task_run(
    user_id: str, session_id: str, turn_id: str
) -> TaskRunAuthority:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        task = next((task for task in tasks if task.session_id == session_id), None)
        if task is None:
            return TaskRunAuthority()
        if turn_id in task.started_turn_ids:
            return TaskRunAuthority(task=task, duplicate_turn=True)
        held = (
            task.schedule is not None
            or planning_hold(task, tasks) is not None
            or any(
                item.paused or not item.accepted or item.status == "canceled"
                for item in ancestors(task, tasks)
            )
        )
        dependencies_done = all(
            any(item.id == dependency and item.status == "done" for item in tasks)
            for parent in ancestors(task, tasks)
            for dependency in parent.dependencies
        )
        can_execute = not (
            held
            or not dependencies_done
            or (task.question and task.question.answers is None)
            or not task.assignee
            or task.assignee.kind == "human"
            or task.status in ("done", "canceled", "needs_you")
            or task.last_turn_id == turn_id
        )
        task.started_turn_ids.append(turn_id)
        task.last_turn_id = turn_id
        if can_execute:
            task.status, task.activity, task.dispatch_state = (
                "working",
                "Working on your task",
                "sent",
            )
        record(
            task,
            task.assignee.name if task.assignee else "AutoPilot",
            "Started working" if can_execute else "Continuing task conversation",
        )
        await _save(tx, task)
        return TaskRunAuthority(task=task, can_execute=can_execute)
