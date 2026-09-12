import hashlib
import json
from datetime import UTC, datetime, timedelta

from prisma import Prisma
from pydantic import BaseModel, Field

from backend.api.features.tasks.context import planning_context
from backend.api.features.tasks.domain import ancestors
from backend.api.features.tasks.models import TaskAssignee, WorkspaceTask
from backend.api.features.tasks.repository import _get, _load
from backend.data.db import prisma


class PlanningEnvironment(BaseModel):
    candidates: list[TaskAssignee]
    roster: list[dict]
    conversations: dict[str, list[dict]] = Field(default_factory=dict)
    busy_sessions: set[str] = Field(default_factory=set)


class TaskPlanningInputs(BaseModel):
    context: dict
    candidates: list[TaskAssignee]
    fingerprint: str
    busy: bool = False


async def workspace_task_planning_inputs(
    user_id: str, task_id: str
) -> TaskPlanningInputs:
    tasks = await _load(prisma, user_id)
    task = _get(tasks, task_id)
    environment = await load_planning_environment(
        prisma, user_id, ancestors(task, tasks)
    )
    return task_planning_inputs(task, tasks, environment)


async def load_planning_environment(
    tx: Prisma, user_id: str, scope: list[WorkspaceTask]
) -> PlanningEnvironment:
    experts = await tx.expert.find_many(
        where={
            "ownerUserId": user_id,
            "isTemplate": False,
            "isArchived": False,
            "visibility": "PRIVATE",
            "schedulesPausedAt": None,
        },
        order={"id": "asc"},
    )
    candidates = [
        TaskAssignee(kind="human", id=user_id, name="You"),
        TaskAssignee(kind="auto", id="auto", name="AutoPilot"),
        *[
            TaskAssignee(
                kind="expert",
                id=expert.id,
                name=expert.name,
                role=expert.role,
                avatar_url=expert.avatarUrl,
                color=expert.color,
            )
            for expert in experts
        ],
    ]
    roster = [
        {
            "id": user_id,
            "kind": "human",
            "name": "You",
            "role": "The user: physical work, personal decisions and approvals.",
        },
        {
            "id": "auto",
            "kind": "auto",
            "name": "AutoPilot",
            "role": "Coordinates outcomes spanning several Experts and owns the parent task.",
        },
        *[
            {
                "id": expert.id,
                "kind": "expert",
                "name": expert.name,
                "role": expert.role,
                "bio": expert.bio,
                "skills": sorted(expert.skills),
                "identity": expert.identity[:6000],
                "boundaries": expert.boundaries,
            }
            for expert in experts
        ],
    ]
    environment = PlanningEnvironment(candidates=candidates, roster=roster)
    session_ids = {
        session_id
        for task in scope
        for session_id in (task.session_id, task.source_session_id)
        if session_id
    }
    if not session_ids:
        return environment
    sessions = await tx.chatsession.find_many(
        where={"userId": user_id, "id": {"in": sorted(session_ids)}},
        include={
            "Messages": {
                "where": {
                    "role": {"in": ["user", "assistant"]},
                    "content": {"not": None},
                },
                "order_by": {"sequence": "desc"},
                "take": 12,
            }
        },
    )
    quiet_before = datetime.now(UTC) - timedelta(seconds=10)
    for session in sessions:
        messages = session.Messages or []
        if session.chatStatus != "idle" or any(
            message.createdAt > quiet_before for message in messages
        ):
            environment.busy_sessions.add(session.id)
        environment.conversations[session.id] = [
            {
                "role": message.role,
                "sequence": message.sequence,
                "content": (message.content or "")[-2000:],
            }
            for message in reversed(messages)
            if message.content
        ]
    return environment


def task_planning_inputs(
    task: WorkspaceTask, tasks: list[WorkspaceTask], environment: PlanningEnvironment
) -> TaskPlanningInputs:
    session_ids = list(
        dict.fromkeys(
            session_id
            for item in ancestors(task, tasks)
            for session_id in (item.session_id, item.source_session_id)
            if session_id
        )
    )
    conversations = [
        {"session_id": session_id, "messages": environment.conversations[session_id]}
        for session_id in session_ids
        if environment.conversations.get(session_id)
    ][:4]
    context = {
        **planning_context(task, tasks),
        "roster": environment.roster,
        "conversations": conversations,
    }
    fingerprint = hashlib.sha256(
        json.dumps(context, sort_keys=True, default=str).encode()
    ).hexdigest()
    return TaskPlanningInputs(
        context=context,
        candidates=environment.candidates,
        fingerprint=fingerprint,
        busy=bool(set(session_ids) & environment.busy_sessions),
    )
