"""AskQuestionTool - Ask the user one or more clarifying questions."""

import logging
from datetime import UTC, datetime
from typing import Any

from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskQuestion,
    TaskQuestionItem,
)
from backend.api.features.tasks.question_routing import pending_human_questions
from backend.copilot.model import ChatSession, PendingQuestion
from backend.data.db_accessors import chat_db, tasks_db

from .base import BaseTool
from .models import ClarificationNeededResponse, ClarifyingQuestion, ToolResponseBase

logger = logging.getLogger(__name__)

# The model can be steered by untrusted page content (agent_browser, MCP tools),
# and every option is replayed into context on each subsequent turn.
MAX_QUESTIONS = 10
MAX_OPTIONS = 25
MAX_OPTION_LENGTH = 200
MAX_OPTION_SCAN = 500


class AskQuestionTool(BaseTool):
    """Ask the user one or more clarifying questions and wait for answers.

    Use this tool when the user's request is ambiguous and you need more
    information before proceeding.  Call find_block or other discovery tools
    first to ground your questions in real platform options, then call this
    tool with concrete questions listing those options.
    """

    @property
    def name(self) -> str:
        return "ask_question"

    @property
    def description(self) -> str:
        return "Ask one or more questions, each with its own recipient. In a linked Tasks conversation use target_kind auto for AutoPilot (Otto), expert with an existing target_id from list_team for a specialty question, or human for the user. Teammate answers return automatically without changing the task owner. Use purpose approval for consent/authorization, account_setup for credentials or connecting accounts; these must target human. Ask teammates about strategy and domain knowledge before asking the user to relay information. In a regular chat use delegate_to_expert for teammate questions and this tool for human questions."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": {
                                "type": "string",
                                "description": "The question text.",
                            },
                            "options": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": (
                                    "Options for this question, offered to the "
                                    "user as choices; they can always type a "
                                    "custom answer instead. Exactly one option "
                                    "is chosen, so split a question that needs "
                                    "several answers into separate questions."
                                ),
                            },
                            "target_kind": {
                                "type": "string",
                                "enum": ["human", "auto", "expert"],
                                "description": "Who should answer this question. Defaults to human. AutoPilot/Otto coordinates; use expert for a teammate's specialty. Requires a linked task for non-human recipients.",
                            },
                            "target_id": {
                                "type": "string",
                                "description": "Existing Expert ID or exact name from list_team; required for target_kind expert.",
                            },
                            "purpose": {
                                "type": "string",
                                "enum": ["clarification", "approval", "account_setup"],
                                "description": "Use approval for human decisions or authorization, account_setup for credentials/connections. Both stay human. Defaults to clarification.",
                            },
                            "keyword": {
                                "type": "string",
                                "description": "Short label for this question.",
                            },
                        },
                        "required": ["question"],
                    },
                    "description": (
                        "One or more clarifying questions. Each item has "
                        "'question' (required), 'options', and 'keyword'."
                    ),
                },
            },
            "required": ["questions"],
        }

    @property
    def requires_auth(self) -> bool:
        return False

    async def _execute(
        self,
        user_id: str | None,
        session: ChatSession,
        **kwargs: Any,
    ) -> ToolResponseBase:
        raw_questions = kwargs.get("questions", [])
        if not isinstance(raw_questions, list) or not raw_questions:
            raise ValueError("ask_question requires a non-empty 'questions' array")

        questions = _parse_questions(raw_questions)
        if not questions:
            raise ValueError(
                "ask_question requires at least one valid question in 'questions'"
            )

        targeted = any(q.target_kind != "human" for q in questions)
        if targeted and not (
            session and session.user_id and session.metadata.workspace_task_id
        ):
            raise ValueError(
                "In a regular chat use delegate_to_expert for teammate questions; ask_question targets require a linked task"
            )
        targets: list[TaskAssignee | None] = []
        if targeted:
            from backend.api.features.tasks.service import task_assignees

            roster = await task_assignees(session.user_id)
            for q in questions:
                if q.target_kind == "human":
                    targets.append(None)
                    continue
                if q.purpose != "clarification":
                    raise ValueError("Approvals and account setup must target human")
                matches = [
                    a
                    for a in roster
                    if a.kind == q.target_kind
                    and (
                        a.kind == "auto" or a.id == q.target_id or a.name == q.target_id
                    )
                ]
                if len(matches) != 1:
                    raise ValueError(
                        "Choose an available recipient from list_team using their exact ID"
                    )
                targets.append(matches[0])

        task_question = None
        updated_task = None
        task_id = None
        text = "; ".join(q.question for q in questions)
        if session:
            if session.metadata.workspace_task_id and session.user_id:
                task_question = TaskQuestion(
                    questions=[
                        TaskQuestionItem(
                            question=q.question,
                            keyword=q.keyword or str(i),
                            options=q.options or [],
                            target=targets[i] if targeted else None,
                            purpose=q.purpose,
                        )
                        for i, q in enumerate(questions)
                    ]
                )
                updated_task = await tasks_db().workspace_task_run_event(
                    session.user_id,
                    session.session_id,
                    "question",
                    question=task_question,
                )
                if (
                    updated_task
                    and updated_task.question
                    and updated_task.question.id == task_question.id
                ):
                    task_id = updated_task.id
                else:
                    task_question = None
                questions = [
                    (
                        q.model_copy(
                            update={"keyword": task_question.questions[i].keyword}
                        )
                        if task_question
                        else q
                    )
                    for i, q in enumerate(questions)
                ]
            if task_question and updated_task:
                human_questions = pending_human_questions(updated_task)
                session.metadata.pending_question = (
                    PendingQuestion(
                        text="; ".join(item.question for item in human_questions),
                        asked_at=task_question.asked_at,
                        task_id=task_id,
                        question_id=task_question.id,
                    )
                    if human_questions
                    else None
                )
            elif targeted:
                raise ValueError(
                    "The linked task is no longer available for question routing"
                )
            else:
                await _mark_pending(session, text)
        return ClarificationNeededResponse(
            message=text,
            session_id=session.session_id if session else None,
            questions=questions,
            task_id=task_id,
            task_question_id=task_question.id if task_question else None,
        )


async def _mark_pending(session: ChatSession, text: str) -> None:
    """Park the question on the session so Home can surface it.

    Best-effort: a failure here costs the user a "Needs You" row, and must
    never cost them the answer they were about to be asked for.
    """
    asked_at = datetime.now(UTC)
    session.metadata.pending_question = PendingQuestion(text=text, asked_at=asked_at)
    try:
        await chat_db().set_session_pending_question(
            session.session_id, session.user_id, text, asked_at
        )
    except Exception as e:
        logger.warning(
            "Could not record pending question for session %s: %s",
            session.session_id,
            e,
        )


def _parse_questions(raw: list[Any]) -> list[ClarifyingQuestion]:
    """Parse and validate raw question dicts into ClarifyingQuestion objects."""
    return [
        q
        for idx, item in enumerate(raw[:MAX_QUESTIONS])
        if (q := _parse_one(item, idx)) is not None
    ]


def _parse_one(item: Any, idx: int) -> ClarifyingQuestion | None:
    """Parse a single question item, returning None for invalid entries."""
    if not isinstance(item, dict):
        logger.warning("ask_question: skipping non-dict item at index %d", idx)
        return None

    text = item.get("question")
    if not isinstance(text, str) or not text.strip():
        logger.warning(
            "ask_question: skipping item at index %d with missing/empty question",
            idx,
        )
        return None

    raw_keyword = item.get("keyword")
    keyword = (
        str(raw_keyword).strip()
        if raw_keyword is not None and str(raw_keyword).strip()
        else f"question-{idx}"
    )

    options = _parse_options(item.get("options"))

    return ClarifyingQuestion(
        question=text.strip(),
        keyword=keyword,
        example=", ".join(options) if options else None,
        options=options,
        target_kind=item.get("target_kind", "human"),
        target_id=item.get("target_id"),
        purpose=item.get("purpose", "clarification"),
    )


def _parse_options(raw: Any) -> list[str]:
    """Strip the option strings and drop repeats, keeping the model's order.

    Repeats would otherwise reach `example` as "Yes, Yes". Non-strings are
    dropped rather than coerced: the schema declares strings, and `str()` would
    surface a Python repr like "['a']" as a tappable choice. Capped because the
    options are LLM-controlled and get replayed into context every turn.
    """
    if not isinstance(raw, list):
        return []
    unique: dict[str, None] = {}
    # Collect up to the cap rather than normalizing everything and slicing
    # after: a huge array would otherwise cost a strip per entry. Blanks and
    # repeats drop out, so the scan needs its own bound to stay finite.
    for option in raw[:MAX_OPTION_SCAN]:
        if not isinstance(option, str):
            continue
        if trimmed := option.strip()[:MAX_OPTION_LENGTH]:
            unique[trimmed] = None
            if len(unique) == MAX_OPTIONS:
                break
    return list(unique)
