from backend.api.features.tasks.domain import TaskConflict, is_runnable, record
from backend.api.features.tasks.models import WorkspaceTask
from backend.api.features.tasks.question_routing import refresh_question_state
from backend.api.features.tasks.question_sync import sync_task_question
from backend.api.features.tasks.repository import _load, _lock, _save
from backend.data.db import prisma


async def answer_workspace_task_from_chat(
    user_id: str,
    session_id: str,
    question_id: str,
    answers: dict[str, str],
    source_message_id: str,
) -> WorkspaceTask:
    from backend.copilot.service import strip_injected_context_for_display

    async with prisma.tx() as tx:
        await _lock(tx, user_id)
        tasks = await _load(tx, user_id)
        task = next((t for t in tasks if t.session_id == session_id), None)
        if not task or task.status in ("done", "canceled"):
            raise TaskConflict(
                "Open this task's current conversation to record an answer"
            )
        question = task.question
        if not question or question.id != question_id:
            raise TaskConflict(
                "This question has changed; inspect the current task before answering"
            )
        session = await tx.chatsession.find_first(
            where={"id": session_id, "userId": user_id}
        )
        if not session:
            raise TaskConflict("Task conversation not found in your workspace")
        source = await tx.chatmessage.find_first(
            where={"id": source_message_id, "sessionId": session_id, "role": "user"},
        )
        if (
            not source
            or source.id != source_message_id
            or source.id == task.dispatch_id
            or source.createdAt < question.asked_at
            or not source.content
        ):
            raise TaskConflict(
                "Use a saved user reply from this conversation after this question was asked"
            )
        reply = strip_injected_context_for_display(source.content).strip()
        items = {item.keyword: item for item in question.questions}
        if any(
            key not in items
            or ((target := items[key].target) is not None and target.kind != "human")
            or not answer.strip()
            or answer.strip() not in reply
            for key, answer in answers.items()
        ):
            raise TaskConflict(
                "Match only questions addressed to the user, using exact quotes from the selected user reply"
            )
        if not reply:
            raise TaskConflict("The user reply is empty")
        if any(
            items[key].answer and items[key].answer != answer.strip()
            for key, answer in answers.items()
        ):
            latest = await tx.chatmessage.find_first(
                where={"sessionId": session_id, "role": "user"},
                order={"sequence": "desc"},
            )
            if not latest or latest.id != source.id:
                raise TaskConflict(
                    "Use the latest user reply when correcting a recorded answer"
                )
        changed = False
        for key, answer in answers.items():
            item = items[key]
            if item.answer != answer.strip():
                item.answer, item.answered_by = answer.strip(), user_id
                changed = True
        note = f"Chat reply ({source.id}):\n{reply}"
        if note not in question.context:
            question.context = (question.context + "\n" + note).strip()[-10000:]
            changed = True
        if not changed:
            return task
        question.answers = None
        refresh_question_state(task)
        if question.answers is not None:
            task.dispatch_message = ""
            candidate = task.model_copy(
                update={"status": "todo", "dispatch_state": None}
            )
            if is_runnable(candidate, tasks):
                task.status, task.dispatch_state = "working", "sent"
                task.activity = "Answer recorded in chat; continuing this conversation"
            else:
                task.status, task.dispatch_state = "todo", None
                task.activity = "Answer recorded; execution constraints still apply"
        record(
            task,
            user_id,
            (
                "Question updated from chat"
                if answers
                else "Question context updated from chat"
            ),
        )
        await sync_task_question(tx, task)
        await _save(tx, task)
        return task
