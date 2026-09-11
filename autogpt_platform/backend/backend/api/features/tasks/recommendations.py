import logging

from pydantic import BaseModel, Field

from backend.api.features.tasks.context import planning_context
from backend.api.features.tasks.models import WorkspaceTask
from backend.api.features.tasks.planning_model import (
    planning_completion,
    planning_roster,
    resolve_candidate,
)
from backend.data.db_accessors import tasks_db

logger = logging.getLogger(__name__)


class OwnerChoice(BaseModel):
    assignee_id: str
    reason: str = Field(min_length=1, max_length=300)


class OwnerRecommendation(BaseModel):
    choice: OwnerChoice
    alternatives: list[OwnerChoice] = Field(default_factory=list, max_length=3)


_PROMPT = """Choose who should own this task using its meaning, parent outcome, project,
existing steps, and the actual roster's roles, skills and identities. For a concrete
specialist deliverable choose the best relevant existing Expert, even when the task
and their title use different words. For an epic or outcome spanning multiple
specialties choose AutoPilot, who retains parent ownership and delegates subtasks to
Experts. Human physical work, personal decisions and approvals belong to the user.
Return the exact eligible assignee_id, a short specific explanation, and up to three
credible alternatives with their tradeoffs. Never invent an Expert, use an Expert
outside this roster, or treat an existing confirmed assignment as a suggestion.
This is a recommendation only. No work is executed or assigned by this response."""


async def suggest_task_assignee(
    user_id: str, task_id: str, force: bool = False
) -> None:
    task = await tasks_db().begin_workspace_task_suggestion(user_id, task_id, force)
    if task:
        await generate_task_suggestion(user_id, task)


async def generate_task_suggestion(user_id: str, task: WorkspaceTask) -> None:
    suggestion, alternatives, error = None, [], ""
    try:
        tasks = await tasks_db().list_workspace_tasks(user_id)
        candidates, roster = await planning_roster(user_id)
        response = await planning_completion(
            _PROMPT,
            {**planning_context(task, tasks), "roster": roster},
            OwnerRecommendation,
        )
        suggestion = resolve_candidate(
            candidates, response.choice.assignee_id, response.choice.reason
        )
        alternatives = [
            resolve_candidate(candidates, item.assignee_id, item.reason)
            for item in response.alternatives
            if item.assignee_id != suggestion.id
        ]
    except Exception:
        logger.warning(
            "Task owner recommendation failed for %s", task.id, exc_info=True
        )
        suggestion, alternatives = None, []
        error = "Could not get an owner suggestion from the configured model. Try again or choose an owner."
    await tasks_db().finish_workspace_task_suggestion(
        user_id, task.id, task.suggestion_request_id, suggestion, alternatives, error
    )
