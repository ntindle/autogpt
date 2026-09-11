import logging
from uuid import NAMESPACE_URL, uuid5

from pydantic import BaseModel, Field

from backend.api.features.tasks.context import planning_context
from backend.api.features.tasks.models import (
    TaskBreakdownAccept,
    TaskBreakdownStep,
    WorkspaceTask,
)
from backend.api.features.tasks.planning_model import (
    planning_completion,
    planning_roster,
    resolve_candidate,
)
from backend.api.features.tasks.service import dispatch_user_tasks, task_assignees
from backend.data.db_accessors import tasks_db
from backend.util.exceptions import NotFoundError

logger = logging.getLogger(__name__)


class ProposedStep(BaseModel):
    key: str
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(min_length=1, max_length=4000)
    assignee_id: str
    reason: str = Field(min_length=1, max_length=300)
    depends_on: list[str] = Field(default_factory=list)


class ProposedBreakdown(BaseModel):
    steps: list[ProposedStep] = Field(min_length=1, max_length=12)


_PROMPT = """Break this task into a useful next level of work, preserving its meaning and
parent/project context. An epic should first become a small set of coherent workstreams
or milestones, each independently assignable; avoid dumping dozens of tiny actions.
Any of those workstreams can be broken down again later. For a narrow task produce
concrete actionable steps. Respect the requested detail level: milestones = major
outcomes, steps = actionable deliverables, small_steps = smaller manageable actions.
Use the actual roster's skills and identities to suggest the right owner for EACH
step. AutoPilot coordinates cross-specialty outcomes and keeps the parent; Experts
own specialist subtasks. Physical actions and approvals belong to the user. An
approval is its own human task, not assumed permission to purchase or publish.
Do not redo, reassign or discard existing steps or accepted work. If a task already
has work, suggest only necessary missing steps. Do not invent orders, measurements,
products, budgets, or requirements: ask for missing decisions in the step description.
Include enough context and a concrete expected result in each description for its
Expert to understand the handoff. Represent necessary sequencing in depends_on using
the keys of EARLIER proposed steps (no cycles); independent work can happen together.
Use unique short keys and exact assignee_id values from the supplied eligible roster.
Return a preview only. It will be edited and accepted before any new tasks are added."""


async def generate_task_breakdown(user_id: str, task: WorkspaceTask) -> None:
    preview = task.breakdown
    if not preview:
        return
    steps, error = [], ""
    try:
        tasks = await tasks_db().list_workspace_tasks(user_id)
        candidates, roster = await planning_roster(user_id)
        response = await planning_completion(
            _PROMPT,
            {
                **planning_context(task, tasks),
                "roster": roster,
                "detail": preview.detail,
                "guidance": preview.guidance,
            },
            ProposedBreakdown,
        )
        steps = resolve_steps(response, candidates, preview.id)
    except Exception:
        logger.warning("Task breakdown failed for %s", task.id, exc_info=True)
        error = "Could not generate steps with the configured model. Try again; your existing work is unchanged."
    await tasks_db().finish_workspace_task_breakdown(
        user_id, task.id, preview.id, steps, error
    )


def resolve_steps(
    response: ProposedBreakdown, candidates, preview_id: str
) -> list[TaskBreakdownStep]:
    ids: dict[str, str] = {}
    steps = []
    for item in response.steps:
        if item.key in ids or any(key not in ids for key in item.depends_on):
            raise ValueError("The model returned an invalid step dependency")
        step = TaskBreakdownStep(
            id=str(uuid5(NAMESPACE_URL, f"task-breakdown:{preview_id}:{item.key}")),
            title=item.title.strip(),
            description=item.description,
            suggestion=resolve_candidate(candidates, item.assignee_id, item.reason),
            dependencies=[ids[key] for key in item.depends_on],
        )
        ids[item.key] = step.id
        steps.append(step)
    return steps


async def accept_task_breakdown(
    user_id: str, task_id: str, request: TaskBreakdownAccept
) -> WorkspaceTask:
    candidates = await task_assignees(user_id)
    for step in request.steps:
        if step.assignee:
            canonical = next(
                (
                    a
                    for a in candidates
                    if a.id == step.assignee.id and a.kind == step.assignee.kind
                ),
                None,
            )
            if canonical is None:
                raise NotFoundError(
                    "An owner is no longer available. Choose another owner."
                )
            step.assignee = canonical.model_copy(
                update={"reason": step.assignee.reason}
            )
    task = await tasks_db().accept_workspace_task_breakdown(user_id, task_id, request)
    await dispatch_user_tasks(user_id)
    return task
