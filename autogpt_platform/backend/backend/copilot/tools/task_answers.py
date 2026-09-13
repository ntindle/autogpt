from backend.api.features.tasks.domain import TaskConflict
from backend.api.features.tasks.question_routing import pending_human_questions
from backend.copilot.model import ChatSession, PendingQuestion, invalidate_session_cache
from backend.data.db_accessors import tasks_db


async def record_chat_answer(
    user_id: str,
    session: ChatSession,
    question_id: str,
    answers: dict[str, str],
    source_quote: str = "",
):
    from backend.copilot.service import strip_injected_context_for_display

    source = next(
        (
            m
            for m in reversed(session.messages)
            if m.role == "user"
            and (
                not source_quote
                or source_quote in strip_injected_context_for_display(m.content or "")
            )
        ),
        None,
    )
    if not source or not source.id:
        raise TaskConflict(
            "Choose a saved user reply from this conversation; source_quote must match their exact wording"
        )
    task = await tasks_db().answer_workspace_task_from_chat(
        user_id, session.session_id, question_id, answers, source.id
    )
    pending = pending_human_questions(task)
    session.metadata.pending_question = (
        PendingQuestion(
            text="; ".join(item.question for item in pending),
            asked_at=task.question.asked_at,
            task_id=task.id,
            question_id=task.question.id,
        )
        if pending and task.question
        else None
    )
    await invalidate_session_cache(session.session_id)
    return task
