import logging
import re

from backend.api.features.tasks.domain import ancestors
from backend.api.features.tasks.models import TaskAssignee, TaskCommand, WorkspaceTask
from backend.api.features.tasks.service import task_assignees
from backend.data.db_accessors import tasks_db

logger = logging.getLogger(__name__)
_STOP_WORDS = {
    "this",
    "that",
    "with",
    "from",
    "your",
    "have",
    "work",
    "task",
    "expert",
    "help",
    "make",
    "create",
    "write",
    "draft",
    "about",
    "their",
    "will",
    "into",
    "need",
}


async def suggest_task_assignee(user_id: str, task_id: str) -> None:
    try:
        tasks = await tasks_db().list_workspace_tasks(user_id)
        task = next((task for task in tasks if task.id == task_id), None)
        if task is None or task.assignee:
            return
        candidates = await task_assignees(user_id)
        suggestion = recommend_assignee(task, tasks, candidates)
        await tasks_db().command_workspace_task(
            user_id,
            task_id,
            TaskCommand(operation="suggest", version=task.version, assignee=suggestion),
        )
    except Exception:
        logger.info("Task %s kept its existing recommendation", task_id, exc_info=True)


def recommend_assignee(
    task: WorkspaceTask, tasks: list[WorkspaceTask], candidates: list[TaskAssignee]
) -> TaskAssignee:
    context = " ".join(
        f"{item.title} {item.description} {item.project}"
        for item in ancestors(task, tasks)
    ).lower()
    human = next(
        (candidate for candidate in candidates if candidate.kind == "human"), None
    )
    if human and re.search(
        r"\b(clean|plug in|connect the camera|choose a date|pick a date|approve|review and approve)\b",
        task.title,
        re.IGNORECASE,
    ):
        return human.model_copy(
            update={
                "reason": "This looks like a personal decision or physical step. You can choose another owner."
            }
        )
    words = set(re.findall(r"[a-z]{4,}", context)) - _STOP_WORDS
    scored = sorted(
        [
            (
                len(
                    words
                    & (
                        set(
                            re.findall(
                                r"[a-z]{4,}",
                                f"{candidate.name} {candidate.reason or ''}".lower(),
                            )
                        )
                        - _STOP_WORDS
                    )
                ),
                candidate,
            )
            for candidate in candidates
            if candidate.kind == "expert"
        ],
        key=lambda entry: entry[0],
        reverse=True,
    )
    if (
        scored
        and scored[0][0] > 0
        and (len(scored) == 1 or scored[0][0] > scored[1][0])
    ):
        candidate = scored[0][1]
        return candidate.model_copy(
            update={
                "reason": f"{candidate.name}'s existing role matches this task and its project context. Confirm to delegate."
            }
        )
    return TaskAssignee(
        kind="auto",
        id="auto",
        name="Auto",
        reason="Auto can clarify the outcome and coordinate your Experts. No work starts until you confirm.",
    )
