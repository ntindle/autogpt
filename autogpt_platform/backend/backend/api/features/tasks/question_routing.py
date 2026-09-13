from uuid import uuid4

from backend.api.features.tasks.domain import TaskConflict, ancestors, record
from backend.api.features.tasks.models import (
    TaskAssignee,
    TaskCommand,
    TaskQuestionItem,
    TaskQuestionSource,
    WorkspaceTask,
)


def pending_human_questions(task: WorkspaceTask) -> list[TaskQuestionItem]:
    if not task.question or task.question.answers is not None:
        return []
    return [
        item
        for item in task.question.questions
        if not item.answer and (not item.target or item.target.kind == "human")
    ]


def refresh_question_state(task: WorkspaceTask, feedback: str = "") -> None:
    question = task.question
    if not question or question.answers is not None:
        return
    if feedback.strip():
        question.context = (question.context + "\n" + feedback.strip()).strip()[:10000]
    if all(item.answer for item in question.questions):
        question.answers = {
            item.keyword: item.answer or "" for item in question.questions
        }
        authors = {item.answered_by for item in question.questions}
        question.answered_by = next(iter(authors)) if len(authors) == 1 else "team"
        if not task.assignee or task.assignee.kind == "human":
            task.dispatch_state, task.dispatch_message = None, ""
            task.status, task.activity = "todo", "Answer recorded"
            return
        task.dispatch_message = "Answers to your questions:\n" + "\n\n".join(
            f"{item.question}\nAnswered by {item.answered_by or 'You'}:\n{item.answer}"
            for item in question.questions
        )
        if question.context:
            task.dispatch_message += (
                "\n\nAdditional context from your reply:\n" + question.context
            )
        task.dispatch_id = str(uuid4())
        task.dispatch_state = "pending"
        task.status, task.activity = "todo", "Answers recorded; waiting to continue"
    elif pending_human_questions(task):
        task.status, task.activity = "needs_you", "Waiting for your answer"
    else:
        names = dict.fromkeys(
            item.target.name
            for item in question.questions
            if not item.answer and item.target
        )
        task.status, task.activity = "blocked", "Waiting for " + ", ".join(names)


def route_question(
    task: WorkspaceTask, command: TaskCommand, tasks: list[WorkspaceTask]
) -> None:
    question = task.question
    if (
        task.status in ("done", "canceled")
        or not question
        or question.id != command.question_id
        or question.answers is not None
    ):
        raise TaskConflict("This question is no longer waiting for an answer")
    item = next(
        (q for q in question.questions if q.keyword == command.question_keyword), None
    )
    if not item or item.answer:
        raise TaskConflict("This question is no longer waiting for an answer")
    target = command.question_target
    if not target:
        raise TaskConflict("Choose who should answer the question")
    if item.purpose != "clarification" and target.kind != "human":
        raise TaskConflict("Approvals and account setup must stay with you")
    if item.target and (item.target.kind, item.target.id) == (target.kind, target.id):
        return
    validate_question_target(task, target, tasks)
    for old in tasks:
        if old.id == item.consultation_task_id and old.status not in (
            "done",
            "canceled",
        ):
            old.status, old.activity = "canceled", "Question redirected"
            old.dispatch_state = None
            record(old, task.user_id, old.activity)
    item.target, item.consultation_task_id = target, None
    prepare_question_tasks(task, tasks)
    refresh_question_state(task)
    record(task, task.user_id, f"Question sent to {target.name}: {item.question}")


def validate_question_target(
    task: WorkspaceTask, target: TaskAssignee, tasks: list[WorkspaceTask]
) -> None:
    if target.kind == "human":
        return
    chain = ancestors(task, tasks)
    if task.assignee and (task.assignee.kind, task.assignee.id) == (
        target.kind,
        target.id,
    ):
        raise TaskConflict(
            "The task owner already has this question; choose another teammate or You"
        )
    consultations = [item for item in chain if item.question_for]
    if len(consultations) >= 3:
        raise TaskConflict(
            "Ask you to resolve this question instead of passing it between more teammates"
        )
    if any(
        item.assignee
        and (item.assignee.kind, item.assignee.id) == (target.kind, target.id)
        for item in consultations
    ):
        raise TaskConflict("That teammate is already waiting on this question")


def prepare_question_tasks(task: WorkspaceTask, tasks: list[WorkspaceTask]) -> None:
    if not task.question or task.question.answers is not None:
        return
    for item in task.question.questions:
        target = item.target
        if (
            item.answer
            or not target
            or target.kind == "human"
            or item.consultation_task_id
        ):
            continue
        if item.purpose != "clarification":
            raise TaskConflict("Approvals and account setup must stay with you")
        validate_question_target(task, target, tasks)
        if len(tasks) >= 1000:
            raise TaskConflict("This workspace has reached 1,000 tasks")
        consultation = WorkspaceTask(
            user_id=task.user_id,
            organization_id=task.organization_id,
            parent_id=task.id,
            project=task.project,
            required=False,
            title=f"Answer: {item.question}"[:500],
            description=(
                f"Question from {task.assignee.name if task.assignee else 'You'}: {item.question}\n"
                f"Options: {', '.join(item.options) or 'Open answer'}\n\n"
                f"Task: {task.title}\n{task.description}\n"
                "Read the parent task's context and previous answers before responding. "
                "Provide advice or information only. Do not perform the task, change its owner, "
                "approve actions, connect accounts, or act as the user. "
                "Submit your answer using manage_tasks operation submit_result with evidence. "
                "It will return to the requesting task automatically. If a human decision or "
                "account setup is necessary, ask the user with ask_question."
            )[:20000],
            assignee=target,
            question_for=TaskQuestionSource(
                task_id=task.id, question_id=task.question.id, keyword=item.keyword
            ),
        )
        item.consultation_task_id = consultation.id
        tasks.append(consultation)
        record(consultation, task.user_id, f"Question directed to {target.name}")


def submit_question_answer(
    consultation: WorkspaceTask, tasks: list[WorkspaceTask], text: str
) -> None:
    source = consultation.question_for
    if not source:
        return
    consultation.result = text
    consultation.result_version += 1
    consultation.status, consultation.activity = "done", "Answer returned"
    consultation.dispatch_state, consultation.dispatch_message = "finished", ""
    consultation.question = None
    task = next((item for item in tasks if item.id == source.task_id), None)
    if not task or task.status in ("done", "canceled") or not task.question:
        return
    question = task.question
    if question.id != source.question_id or question.answers is not None:
        return
    item = next((q for q in question.questions if q.keyword == source.keyword), None)
    if not item or item.answer or item.consultation_task_id != consultation.id:
        return
    item.answer = text
    item.answered_by = (
        consultation.assignee.name if consultation.assignee else "AutoPilot"
    )
    refresh_question_state(task)
    record(task, item.answered_by, f"Answered: {item.question}")
