from typing import Any

from pydantic import Field

from backend.api.features.tasks.domain import (
    TaskConflict,
    ancestors,
    branch,
    planning_hold,
)
from backend.api.features.tasks.management import MANAGEMENT_OPERATIONS
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
from .task_answers import record_chat_answer
from .task_management import manage_existing_task


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
            "AutoPilot retains parent ownership and delegates specialist child tasks to existing Experts from list_team. "
            "AutoPilot can accept or request changes to a child's result; no executor can accept its own result. "
            "AutoPilot can edit, reparent, assign, cancel, reopen, pause, resume, start, or retry existing tasks across the user's workspace, including from regular chats. "
            "Use reparent with task_id and new_parent_id (null for top level); it preserves IDs, conversations, answers, results, and history, and inherits the new parent's project unless project is supplied. "
            "Use edit for title, description, project, and dependencies. Use cancel to retire duplicates without deleting history. "
            "Use assign (or assign_step) to change an owner, including an existing confirmed owner. Use pause before reassigning or canceling active work, then list until dispatch is no longer claimed/sent and status is no longer working. Never copy a task to move or reroute it. "
            "Use start when the user requests execution of a held task: it enables that branch, preserves sibling holds, and waits for prerequisites. Assignment alone does not release a planning hold. "
            "Expert sessions can only assign unassigned steps within their delegated branch; they cannot manage unrelated tasks. "
            "In any chat, add_step with task_id creates a real child under that owned parent. Outside a delegated task conversation its owner remains a suggestion. Never simulate nesting with title prefixes. "
            "Use list with all_projects=true or project to find existing prerequisites across projects. Expert cross-project links do not expand their delegation or review scope. "
            "Use answer_question in the linked chat to reconcile a clear user reply or correction with the current question_id. "
            "Supply answers as keyword-to-verbatim-user-quote pairs for only the questions actually resolved; unrelated or ambiguous messages are not answers. "
            "Use source_quote to identify an earlier user reply after the question was asked when recovering a stuck conversation; honor later corrections. "
            "An empty answers object saves relevant clarification context without resolving questions. Never invent approval or treat authentication instructions as completed account setup. "
            "This continues the current conversation without scheduling a duplicate and never releases execution holds or accepts results. "
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
                        "assign_step",
                        *sorted(MANAGEMENT_OPERATIONS),
                        "activity",
                        "answer_question",
                        "submit_result",
                        "accept_result",
                        "request_changes",
                    ],
                },
                "question_id": {
                    "type": "string",
                    "description": "For answer_question, the current question batch ID from this task's context or list. Rejects stale questions.",
                },
                "source_quote": {
                    "type": "string",
                    "description": "For answer_question, optional exact quote identifying an earlier user reply in this conversation. Omit to use the latest reply. Use earlier replies only for unresolved items, and honor subsequent corrections. Never use assistant/tool messages as human answers.",
                },
                "answers": {
                    "type": "object",
                    "additionalProperties": {"type": "string"},
                    "description": "For answer_question, map only clearly resolved question keywords to exact quotes from the selected user reply (latest by default). Partial answers and explicit corrections are supported. Use {} to preserve relevant context without answering. Do not infer consent or account setup completion.",
                },
                "task_id": {
                    "type": "string",
                    "description": "For list, an owned branch to inspect, including another project. For add_step, the parent task ID (works from a regular chat). For management, the existing task to change. For review, the child ID. Omitted uses this chat's linked task for progress and result submission.",
                },
                "version": {
                    "type": "integer",
                    "description": "Latest version from list; rejects changes if someone edited the task since you inspected it.",
                },
                "new_parent_id": {
                    "type": ["string", "null"],
                    "description": "For reparent, an existing open outcome ID in this workspace, or null to move the task to the top level. Never create a copy to move a task.",
                },
                "title": {"type": "string"},
                "description": {"type": "string"},
                "evidence": {
                    "type": "string",
                    "description": "Actual result, evidence, output links, or requested changes. Link workspace files as [filename](workspace://file_id) using real returned IDs, not local paths. Never claim completion just because a run ended.",
                },
                "project": {
                    "type": "string",
                    "description": "Project label for capture, edit, or reparent; omit on reparent to inherit the new parent project. For list, find the user's tasks in this project even outside the linked outcome.",
                },
                "all_projects": {
                    "type": "boolean",
                    "description": "For list, search all of the user's projects instead of only this chat's linked branch. Read access does not expand delegation authority.",
                },
                "assignee_kind": {
                    "type": "string",
                    "enum": ["human", "auto", "expert", "unassigned"],
                },
                "assignee_id": {
                    "type": "string",
                    "description": "Existing eligible user or Expert ID. For Auto use auto.",
                },
                "dependencies": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Existing prerequisite task or outcome IDs owned by this user, including other projects. This step waits for all of their accepted results; use list to find real IDs first.",
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
        title: str | None = None,
        description: str | None = None,
        evidence: str = "",
        project: str | None = None,
        question_id: str = "",
        answers: dict[str, str] | None = None,
        source_quote: str = "",
        **kwargs
    ) -> ToolResponseBase:
        if not user_id:
            return ErrorResponse(message="Authentication required")
        root = await tasks_db().workspace_task_for_session(user_id, session.session_id)
        if (
            root
            and root.question_for
            and operation
            not in ("list", "activity", "submit_result", "answer_question")
        ):
            return ErrorResponse(
                message="This consultation can inspect context and submit an answer, but cannot manage task execution or approve work."
            )
        if operation == "answer_question":
            if (
                not root
                or (task_id and task_id != root.id)
                or not question_id
                or answers is None
            ):
                return ErrorResponse(
                    message="Provide this chat's current question_id and an answers object"
                )
            try:
                updated = await record_chat_answer(
                    user_id, session, question_id, answers, source_quote
                )
            except (TaskConflict, ValueError) as exc:
                return ErrorResponse(message=str(exc), session_id=session.session_id)
            return WorkspaceTasksResponse(
                message=(
                    "Answers recorded from your reply. Continue in this conversation within existing execution constraints."
                    if updated.question and updated.question.answers is not None
                    else "Relevant answers and context recorded. Unanswered questions remain open; no automatic continuation was queued."
                ),
                tasks=[updated],
            )
        if operation in MANAGEMENT_OPERATIONS or (
            operation == "assign_step" and not session.expert_id
        ):
            return await manage_existing_task(
                user_id,
                session,
                operation,
                task_id,
                title,
                description,
                project,
                kwargs,
            )
        title, description, project = title or "", description or "", project or ""
        if operation in ("add_step", "assign_step") and (
            root or (operation == "add_step" and task_id)
        ):
            kind = kwargs.get("assignee_kind")
            assignee = (
                TaskAssignee(
                    kind=kind,
                    id=kwargs.get("assignee_id")
                    or (user_id if kind == "human" else "auto"),
                    name="You" if kind == "human" else "Auto",
                )
                if kind and kind != "unassigned"
                else None
            )
            if operation == "assign_step":
                if not assignee or not task_id:
                    return ErrorResponse(
                        message="Choose an existing step and eligible assignee"
                    )
                task = await tasks_db().assign_workspace_task_step(
                    user_id, session.session_id, task_id, assignee
                )
                return WorkspaceTasksResponse(
                    message="Existing step delegated within the outcome; other owners preserved",
                    tasks=[task],
                )
            task = await tasks_db().add_workspace_task_step(
                user_id,
                session.session_id,
                title,
                description,
                assignee,
                bool(kwargs.get("proposed", False)),
                dependencies=kwargs.get("dependencies"),
                parent_id=task_id or None,
            )
            return WorkspaceTasksResponse(
                message=(
                    "Step delegated within the linked outcome"
                    if task.assignee
                    else "Nested step saved with proposed ownership; no execution was authorized by this chat"
                ),
                tasks=[task],
            )
        if operation == "capture":
            task = await tasks_db().create_workspace_task(
                user_id,
                TaskCreate(title=title, description=description, project=project),
                session.organization_id,
                source_session_id=session.session_id,
            )
            return WorkspaceTasksResponse(
                message="Captured; ownership is suggested, not delegated.", tasks=[task]
            )
        if operation == "list":
            tasks = await tasks_db().list_workspace_tasks(user_id)
            if task_id:
                if not any(task.id == task_id for task in tasks):
                    return ErrorResponse(message="Task not found in your workspace")
                tasks = branch(task_id, tasks)
            elif project:
                tasks = [task for task in tasks if task.project == project]
            elif root and not kwargs.get("all_projects", False):
                tasks = branch(root.id, tasks)
            return WorkspaceTasksResponse(message="Your workspace tasks", tasks=tasks)
        if not root:
            return ErrorResponse(
                message="Open a task's linked conversation to manage its work. You can capture tasks here without starting them."
            )
        tasks = await tasks_db().list_workspace_tasks(user_id)
        scope = branch(root.id, tasks)
        if operation in ("accept_result", "request_changes") and (
            planning_hold(root, tasks)
            or any(
                task.paused or not task.accepted or task.status == "canceled"
                for task in ancestors(root, tasks)
            )
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
                    "Answer returned to the requesting task"
                    if operation == "submit_result" and root.question_for
                    else (
                        "Result submitted for acceptance"
                        if operation == "submit_result"
                        else "Activity updated"
                    )
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
