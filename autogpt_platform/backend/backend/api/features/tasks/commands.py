from uuid import uuid4

from backend.api.features.tasks.domain import (
    TaskConflict,
    ancestors,
    can_edit_execution,
    check_structure,
    progress,
    record,
)
from backend.api.features.tasks.models import TaskCommand, WorkspaceTask


def apply_command(
    task: WorkspaceTask,
    command: TaskCommand,
    tasks: list[WorkspaceTask],
    actor: str | None = None,
) -> None:
    actor = actor or task.user_id
    if command.operation != "answer" and task.version != command.version:
        raise TaskConflict("This task changed. Refresh before applying your change.")
    op = command.operation
    if op in ("edit", "assign", "hold", "cancel"):
        can_edit_execution(task)
    if op == "edit":
        _edit(task, command, tasks)
    elif op in ("assign", "suggest"):
        _assign(task, command)
    elif op == "complete":
        _complete(task, tasks)
    elif op in ("accept_result", "request_changes"):
        _review(task, command, tasks, actor)
    elif op == "answer":
        _answer(task, command)
    elif op == "reopen":
        if task.status not in ("done", "canceled"):
            raise TaskConflict("Only completed or canceled tasks can be reopened")
        task.status, task.activity = "todo", "Reopened"
        task.dispatch_state = None
    elif op == "cancel":
        for member in tasks:
            if task.id in {t.id for t in ancestors(member, tasks)}:
                can_edit_execution(member)
        task.status, task.activity = "canceled", "No longer required"
    elif op == "hold":
        for member in tasks:
            if task.id in {t.id for t in ancestors(member, tasks)}:
                can_edit_execution(member)
        task.plan_only = True
    elif op == "activate":
        task.plan_only = False
    elif op == "pause":
        task.paused = True
        task.activity = (
            "Stopping the active attempt"
            if task.dispatch_state in ("sent", "claimed")
            else "Paused"
        )
    elif op == "resume":
        can_edit_execution(task)
        task.paused = False
        task.status = "todo"
    elif op == "retry":
        if task.status != "blocked":
            raise TaskConflict("Only blocked attempts can be retried")
        can_edit_execution(task)
        task.status, task.dispatch_state = "todo", None
    elif op == "accept_scope":
        task.accepted = True
    record(task, actor, op.replace("_", " ").capitalize())


def _edit(
    task: WorkspaceTask, command: TaskCommand, tasks: list[WorkspaceTask]
) -> None:
    for key in ("title", "description", "project", "dependencies"):
        value = getattr(command, key)
        if value is not None:
            if key == "title" and not value.strip():
                raise TaskConflict("A task needs a title")
            setattr(task, key, value)
    if "parent_id" in command.model_fields_set:
        task.parent_id = command.parent_id
    check_structure(task, tasks)


def _assign(task: WorkspaceTask, command: TaskCommand) -> None:
    if command.operation == "suggest":
        if not task.assignee:
            task.suggestion = command.assignee
        return
    if (
        task.assignee
        and command.assignee
        and (task.assignee.kind, task.assignee.id)
        == (command.assignee.kind, command.assignee.id)
    ):
        task.assignee = command.assignee
        return
    if task.assignee == command.assignee:
        return
    task.assignee = command.assignee
    task.suggestion = None
    task.status = "todo"
    task.activity = ""
    task.dispatch_state = None
    if task.session_id:
        task.previous_session_ids.append(task.session_id)
        task.session_id = None


def _complete(task: WorkspaceTask, tasks: list[WorkspaceTask]) -> None:
    if task.schedule:
        raise TaskConflict("Complete an occurrence, not the schedule")
    if task.assignee and task.assignee.kind != "human":
        raise TaskConflict("Agent results must be reviewed before completion")
    done, total = progress(task.id, tasks)
    if any(t.parent_id == task.id and t.accepted for t in tasks) and done != total:
        raise TaskConflict("Finish the required steps before completing this outcome")
    if task.review_of:
        _review(
            task, TaskCommand(operation="accept_result", version=task.version), tasks
        )
    else:
        task.status, task.activity = "done", "Completed"


def _review(
    task: WorkspaceTask,
    command: TaskCommand,
    tasks: list[WorkspaceTask],
    actor: str | None = None,
) -> None:
    actor = actor or task.user_id
    target = next((t for t in tasks if t.id == task.review_of), task)
    can_edit_execution(target)
    if target.question and target.question.answers is None:
        raise TaskConflict("Answer the outstanding question before accepting a result")
    if not target.result or target.status != "needs_you":
        raise TaskConflict("There is no result awaiting acceptance")
    if task.review_of and task.review_version != target.result_version:
        raise TaskConflict("The result changed. Review the latest version.")
    if command.operation == "request_changes":
        if not command.feedback.strip():
            raise TaskConflict("Describe what needs to change")
        can_edit_execution(target)
        target.status, target.dispatch_state = "todo", None
        target.dispatch_message = (
            f"Changes requested for {target.title}:\n{command.feedback}"
        )
        target.activity = "Changes requested"
    else:
        required = [
            t
            for t in tasks
            if t.parent_id == target.id
            and t.accepted
            and t.required
            and t.status != "canceled"
            and not t.review_of
        ]
        if any(progress(t.id, tasks)[0] != progress(t.id, tasks)[1] for t in required):
            raise TaskConflict("Required steps still need to be completed")
        target.status, target.activity = "done", "Result accepted"
    for review in tasks:
        if review.review_of == target.id and review.status != "done":
            review.status = (
                "done" if command.operation == "accept_result" else "canceled"
            )
            record(review, actor, "Review resolved")
    record(target, actor, target.activity)


def _answer(task: WorkspaceTask, command: TaskCommand) -> None:
    question = task.question
    if (
        not question
        or question.id != command.question_id
        or question.answers is not None
    ):
        raise TaskConflict("This question is no longer waiting for an answer")
    answers = command.answers or {}
    if any(not answers.get(q.keyword, "").strip() for q in question.questions):
        raise TaskConflict("Answer every question before submitting")
    if task.dispatch_state == "claimed":
        raise TaskConflict("Wait for the current attempt to finish starting")
    question.answers, question.answered_by = answers, task.user_id
    task.dispatch_message = "Answers to your questions:\n" + "\n\n".join(
        f"{q.question}\n{answers[q.keyword]}" for q in question.questions
    )
    task.dispatch_id = str(uuid4())
    task.dispatch_state = "pending"
    task.status, task.activity = "todo", "Answer recorded; waiting to continue"
