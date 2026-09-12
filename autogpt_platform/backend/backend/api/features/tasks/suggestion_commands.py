from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.models import TaskCommand, WorkspaceTask


def dismiss_suggestion(task: WorkspaceTask, command: TaskCommand) -> None:
    if task.assignee:
        raise TaskConflict("Only unassigned tasks have owner suggestions to dismiss")
    if (
        not task.suggestion
        or command.suggestion_request_id != task.suggestion_request_id
    ):
        raise TaskConflict(
            "The owner suggestion changed. Review the current suggestion."
        )
    task.suggestion, task.suggestion_alternatives = None, []
    task.suggestion_state, task.suggestion_error = "ready", ""
    task.suggestion_request_id, task.suggestion_started_at = "", None
