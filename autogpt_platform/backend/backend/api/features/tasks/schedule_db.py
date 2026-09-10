from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid5

from backend.api.features.tasks.domain import TaskConflict, can_edit_execution, record
from backend.api.features.tasks.models import TaskSchedule, WorkspaceTask
from backend.api.features.tasks.repository import (
    _get,
    _load,
    _lock,
    _prepare_dispatches,
    _save,
)
from backend.data.db import prisma


async def configure_workspace_task_schedule(
    user_id: str, task_id: str, version: int, schedule: TaskSchedule
) -> WorkspaceTask:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        task = _get(await _load(tx, user_id), task_id)
        if task.version != version:
            raise TaskConflict("The task changed. Refresh and try again.")
        can_edit_execution(task)
        schedule.id = schedule.id or str(
            uuid5(NAMESPACE_URL, f"workspace-task-schedule:{task_id}")
        )
        task.schedule = schedule
        task.status, task.activity, task.dispatch_state = "todo", "Scheduled", None
        record(
            task,
            user_id,
            "Schedule configured; each occurrence completes independently",
        )
        await _save(tx, task)
        return task


async def create_workspace_task_occurrence(
    user_id: str, task_id: str, schedule_id: str, occurrence_key: str
) -> WorkspaceTask | None:
    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        template = _get(tasks, task_id)
        if (
            not template.schedule
            or template.schedule.id != schedule_id
            or template.schedule.paused
            or template.status == "canceled"
        ):
            return None
        occurrence_id = str(
            uuid5(
                NAMESPACE_URL,
                f"workspace-task-occurrence:{schedule_id}:{occurrence_key}",
            )
        )
        existing = next((task for task in tasks if task.id == occurrence_id), None)
        if existing:
            return existing
        occurrence = WorkspaceTask(
            id=occurrence_id,
            user_id=user_id,
            organization_id=template.organization_id,
            title=template.title,
            description=template.description,
            project=template.project,
            assignee=template.assignee,
            suggestion=template.suggestion,
            parent_id=template.parent_id,
            plan_only=template.plan_only,
            occurrence_of=template.id,
            dependencies=template.dependencies.copy(),
            accepted=template.accepted,
            required=template.required,
        )
        record(occurrence, "Schedule", f"Occurrence for {occurrence_key}")
        tasks.append(occurrence)
        _prepare_dispatches(tasks)
        await _save(tx, occurrence)
        template.activity = f"Last occurrence: {datetime.now(UTC).isoformat()}"
        record(template, "Schedule", "Created a separate occurrence")
        await _save(tx, template)
        return occurrence
