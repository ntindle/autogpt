from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.models import TaskAssignee, TaskCommand
from backend.copilot.model import ChatSession
from backend.data.db_accessors import tasks_db
from backend.util.exceptions import NotFoundError

from .models import ErrorResponse, ToolResponseBase


async def manage_existing_task(
    user_id: str,
    session: ChatSession,
    operation: str,
    task_id: str,
    title: str | None,
    description: str | None,
    project: str | None,
    arguments: dict,
) -> ToolResponseBase:
    from backend.api.features.tasks.service import execute_task_command

    from .manage_tasks import WorkspaceTasksResponse

    try:
        if session.expert_id:
            raise TaskConflict("Only AutoPilot can manage tasks across your workspace")
        tasks = await tasks_db().list_workspace_tasks(user_id)
        target = next((task for task in tasks if task.id == task_id), None)
        if not target:
            raise TaskConflict("Use list to find an existing task in your workspace")
        fields = {
            "operation": "assign" if operation == "assign_step" else operation,
            "version": arguments.get("version", target.version),
        }
        if operation in ("edit", "reparent"):
            fields.update(
                {
                    key: value
                    for key, value in {
                        "title": title,
                        "description": description,
                        "project": project,
                        "dependencies": arguments.get("dependencies"),
                    }.items()
                    if value is not None
                }
            )
            if "new_parent_id" in arguments:
                fields["parent_id"] = arguments["new_parent_id"]
        if operation in ("assign", "assign_step"):
            kind = arguments.get("assignee_kind")
            if kind not in ("human", "auto", "expert", "unassigned"):
                raise TaskConflict("Choose human, auto, expert, or unassigned")
            if kind == "expert" and not arguments.get("assignee_id"):
                raise TaskConflict("Use list_team to choose an existing Expert ID")
            fields["assignee"] = (
                None
                if kind == "unassigned"
                else TaskAssignee(
                    kind=kind,
                    id=arguments.get("assignee_id")
                    or (user_id if kind == "human" else "auto"),
                    name="You" if kind == "human" else "AutoPilot",
                )
            )
        command = TaskCommand.model_validate(fields)
        updated = await execute_task_command(
            user_id, target.id, command, manager_session_id=session.session_id
        )
        return WorkspaceTasksResponse(
            message=(
                "Pause requested. Use list to wait until the active dispatch has finished, then reassign, cancel, or resume the same task."
                if operation == "pause"
                else "Task updated in place; its identity, results, answers, and history are retained."
            ),
            tasks=[updated],
        )
    except (TaskConflict, NotFoundError, ValueError) as exc:
        return ErrorResponse(message=str(exc), session_id=session.session_id)
