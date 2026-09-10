from typing import get_args

from backend.copilot.model import ChatSession
from backend.copilot.permissions import CopilotPermissions, ToolName
from backend.data.db_accessors import tasks_db

PLANNING_TOOLS: list[str] = [
    "ask_question",
    "manage_tasks",
    "find_agent",
    "find_block",
    "find_library_agent",
    "search_docs",
    "get_doc_page",
    "list_team",
    "memory_search",
    "list_workspace_files",
    "read_workspace_file",
    "web_search",
    "web_fetch",
]


async def task_execution_policy(
    session: ChatSession, permissions: CopilotPermissions | None, turn_id: str
) -> tuple[CopilotPermissions | None, str]:
    if not session.metadata.workspace_task_id or not session.user_id:
        return permissions, ""
    authority = await tasks_db().start_workspace_task_run(
        session.user_id, session.session_id, turn_id
    )
    if authority.duplicate_turn:
        raise RuntimeError(
            "This task turn was already claimed; retry with a new attempt if needed"
        )
    task = authority.task
    if not task:
        return (
            CopilotPermissions(tools=[], tools_exclude=False),
            "The linked task is unavailable. No execution is authorized.",
        )
    context = f"This conversation is linked to task {task.id}: {task.title}. Use manage_tasks to read its current context and steps. "
    if authority.can_execute:
        return (
            permissions,
            context
            + "Work is delegated. Respect child assignments; submit evidence through manage_tasks before completion.",
        )
    planning = CopilotPermissions(tools=PLANNING_TOOLS, tools_exclude=False)
    return (
        (
            planning.merged_with_parent(
                permissions, all_tools=frozenset(get_args(ToolName))
            )
            if permissions
            else planning
        ),
        context
        + "Planning and discussion only. Do not execute deliverables; the user can confirm ownership or activate work in Tasks.",
    )
