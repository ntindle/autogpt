from typing import Any

from pydantic import Field

from backend.api.features.tasks.domain import TaskConflict, ancestors, branch
from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskCommand,
    TaskCreate,
    WorkspaceTask,
)
from backend.copilot.model import ChatSession
from backend.data.db_accessors import tasks_db

from .base import BaseTool
from .models import ErrorResponse, ResponseType, ToolResponseBase


class WorkspaceTasksResponse(ToolResponseBase):
    type: ResponseType = ResponseType.WORKSPACE_TASKS
    tasks: list[WorkspaceTask] = Field(default_factory=list)


class ManageTasksTool(BaseTool):
    @property
    def name(self) -> str:
        return "manage_tasks"

    @property
    def requires_auth(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return (
            "Manage durable Tasks in the workspace. Capture saves a task without execution. "
            "In a delegated task chat, inspect the branch, add necessary child tasks, report activity, "
            "or submit_result with evidence for acceptance. New commitments should be proposed, not assumed. "
            "Auto can accept or request changes to a child's result; no executor can accept its own result. "
            "Keep visible tasks at deliverable granularity. Use ask_question for human questions."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": [
                        "list",
                        "capture",
                        "add_step",
                        "activity",
                        "submit_result",
                        "accept_result",
                        "request_changes",
                    ],
                },
                "task_id": {
                    "type": "string",
                    "description": "A child task ID for review; omitted uses this chat's task.",
                },
                "title": {"type": "string"},
                "description": {"type": "string"},
                "evidence": {
                    "type": "string",
                    "description": "Actual result, evidence, output links, or requested changes. Never claim completion just because a run ended.",
                },
                "project": {"type": "string"},
                "assignee_kind": {
                    "type": "string",
                    "enum": ["human", "auto", "expert"],
                },
                "assignee_id": {
                    "type": "string",
                    "description": "Existing eligible user or Expert ID. For Auto use auto.",
                },
                "proposed": {
                    "type": "boolean",
                    "description": "True for uncertain or new commitments outside delegated scope; these do not execute or count as required work.",
                },
            },
            "required": ["operation"],
        }

    async def _execute(
        self,
        user_id: str | None,
        session: ChatSession,
        *,
        operation: str,
        task_id: str = "",
        title: str = "",
        description: str = "",
        evidence: str = "",
        project: str = "",
        **kwargs
    ) -> ToolResponseBase:
        if not user_id:
            return ErrorResponse(message="Authentication required")
        root = await tasks_db().workspace_task_for_session(user_id, session.session_id)
        if operation == "add_step" and root:
            kind = kwargs.get("assignee_kind")
            assignee = (
                TaskAssignee(
                    kind=kind,
                    id=kwargs.get("assignee_id")
                    or (user_id if kind == "human" else "auto"),
                    name="You" if kind == "human" else "Auto",
                )
                if kind
                else None
            )
            task = await tasks_db().add_workspace_task_step(
                user_id,
                session.session_id,
                title,
                description,
                assignee,
                bool(kwargs.get("proposed", False)),
            )
            return WorkspaceTasksResponse(
                message="Step saved within the delegated outcome; uncertain new scope stays proposed.",
                tasks=[task],
            )
        if operation == "capture":
            task = await tasks_db().create_workspace_task(
                user_id,
                TaskCreate(title=title, description=description, project=project),
                session.organization_id,
            )
            return WorkspaceTasksResponse(
                message="Captured; ownership is suggested, not delegated.", tasks=[task]
            )
        if not root:
            return ErrorResponse(
                message="Open a task's linked conversation to manage its work. You can capture tasks here without starting them."
            )
        tasks = await tasks_db().list_workspace_tasks(user_id)
        scope = branch(root.id, tasks)
        if operation in ("accept_result", "request_changes") and any(
            task.plan_only
            or task.paused
            or not task.accepted
            or task.status == "canceled"
            for task in ancestors(root, tasks)
        ):
            return ErrorResponse(
                message="Activate the delegated outcome before reviewing child work"
            )
        try:
            return await self._operate(
                user_id,
                session,
                root,
                scope,
                operation,
                task_id,
                title,
                description,
                evidence,
            )
        except (TaskConflict, ValueError) as exc:
            return ErrorResponse(message=str(exc), session_id=session.session_id)

    async def _operate(
        self,
        user_id: str,
        session: ChatSession,
        root: WorkspaceTask,
        scope: list[WorkspaceTask],
        operation: str,
        task_id: str,
        title: str,
        description: str,
        evidence: str,
    ) -> ToolResponseBase:
        if operation == "list":
            return WorkspaceTasksResponse(message="Shared task branch", tasks=scope)
        if operation == "add_step":
            task = await tasks_db().create_workspace_task(
                user_id,
                TaskCreate(title=title, description=description, parent_id=root.id),
                root.organization_id,
            )
            return WorkspaceTasksResponse(
                message="Added a step. Existing ownership and planning holds remain in effect.",
                tasks=[task],
            )
        if operation in ("activity", "submit_result"):
            if (
                not root.assignee
                or root.assignee.kind == "human"
                or root.plan_only
                or root.paused
            ):
                raise TaskConflict("This task has not been delegated for execution")
            if not evidence.strip():
                raise TaskConflict("Provide the current activity or result evidence")
            updated = await tasks_db().workspace_task_run_event(
                user_id,
                session.session_id,
                "result" if operation == "submit_result" else "activity",
                evidence,
            )
            return WorkspaceTasksResponse(
                message=(
                    "Result submitted for acceptance"
                    if operation == "submit_result"
                    else "Activity updated"
                ),
                tasks=[updated] if updated else [],
            )
        target = next((t for t in scope if t.id == task_id and t.id != root.id), None)
        if (
            session.expert_id
            or not target
            or not root.assignee
            or root.assignee.kind != "auto"
        ):
            raise TaskConflict(
                "Only the delegated Auto coordinator can review another executor's child result"
            )
        if operation not in ("accept_result", "request_changes"):
            raise TaskConflict("Unsupported task operation")
        command = TaskCommand(
            operation=(
                "accept_result" if operation == "accept_result" else "request_changes"
            ),
            version=target.version,
            feedback=evidence,
        )
        updated = await tasks_db().command_workspace_task(
            user_id, target.id, command, actor="Auto"
        )
        return WorkspaceTasksResponse(message="Review recorded", tasks=[updated])
