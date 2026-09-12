from uuid import uuid4

from backend.api.features.tasks.domain import (
    TaskConflict,
    ancestors,
    branch,
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
    if op in ("assign", "hold", "cancel", "submit_result", "complete"):
        can_edit_execution(task)
    if op in ("edit", "reparent"):
        _edit(task, command, tasks, actor)
    elif op in ("assign", "suggest"):
        _assign(task, command, tasks, actor)
    elif op in ("complete", "submit_result"):
        if op == "submit_result" and (not command.evidence.strip() or task.review_of):
            raise TaskConflict("Provide the completed work or links to its deliverable")
        _complete(task, tasks)
        if op == "submit_result":
            task.result = command.evidence.strip()
            task.result_version += 1
            task.activity = "Result submitted by you"
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
        members = branch(task.id, tasks)
        member_ids = {member.id for member in members}
        for member in tasks:
            if member.id in member_ids or member.review_of in member_ids:
                if member.id == task.id or member.status not in ("done", "canceled"):
                    member.status, member.activity = "canceled", "No longer required"
                    member.dispatch_state = None
                    if member.id != task.id:
                        record(member, actor, "Canceled with parent task")
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
        if task.status in ("done", "canceled"):
            raise TaskConflict("Reopen this task before resuming work")
        if task.result and task.status == "needs_you":
            raise TaskConflict("Review this result before starting more work")
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
    task: WorkspaceTask,
    command: TaskCommand,
    tasks: list[WorkspaceTask],
    actor: str,
) -> None:
    reparent = "parent_id" in command.model_fields_set
    if command.operation == "reparent" and not reparent:
        raise TaskConflict("Provide parent_id, or null to move to the top level")
    if reparent and (task.review_of or task.schedule):
        raise TaskConflict("Move the underlying task, not its review or schedule")
    members = branch(task.id, tasks)
    constraints = {member.id: _constraints(member, tasks) for member in members}
    if command.dependencies is not None and command.dependencies != task.dependencies:
        for member in members:
            can_edit_execution(member)
        if any(
            item.id in command.dependencies and (item.schedule or item.review_of)
            for item in tasks
        ):
            raise TaskConflict("Use task prerequisites, not schedules or review items")
    old_project, old_parent_id = task.project, task.parent_id
    if reparent:
        parent = next((item for item in tasks if item.id == command.parent_id), None)
        if command.parent_id and not parent:
            raise TaskConflict("Parent task not found in your workspace")
        if parent and (
            parent.status in ("done", "canceled") or parent.review_of or parent.schedule
        ):
            raise TaskConflict("Choose an open outcome as the parent")
        task.parent_id = command.parent_id
        if parent and command.project is None:
            task.project = parent.project
    for key in ("title", "description", "project", "dependencies"):
        value = getattr(command, key)
        if value is not None:
            if key == "title" and not value.strip():
                raise TaskConflict("A task needs a title")
            setattr(task, key, value)
    for member in members:
        check_structure(member, tasks)
        if _constraints(member, tasks) - constraints[member.id]:
            can_edit_execution(member)
        if reparent and member.id != task.id and member.project == old_project:
            member.project = task.project
            record(member, actor, "Moved with parent outcome")
    if reparent and old_parent_id != task.parent_id:
        for coordinator in tasks:
            if (
                coordinator.id in (old_parent_id, task.parent_id)
                and coordinator.assignee
                and coordinator.assignee.kind == "auto"
                and coordinator.status == "blocked"
                and coordinator.dispatch_state == "finished"
            ):
                coordinator.status, coordinator.dispatch_state = "todo", None
                coordinator.dispatch_message = "Task structure changed. Inspect the current branch and continue coordinating the remaining work."
    if reparent:
        for review in tasks:
            if review.review_of == task.id:
                review.parent_id, review.project = task.parent_id, task.project
                record(review, actor, "Moved with reviewed task")


def _constraints(task: WorkspaceTask, tasks: list[WorkspaceTask]) -> set[str]:
    by_id = {item.id: item for item in tasks}
    constraints = set()
    for item in ancestors(task, tasks):
        if (
            item.paused
            or item.plan_only
            or not item.accepted
            or item.status == "canceled"
        ):
            constraints.add(item.id)
        constraints.update(
            dependency
            for dependency in item.dependencies
            if dependency not in by_id or by_id[dependency].status != "done"
        )
    return constraints


def _assign(
    task: WorkspaceTask, command: TaskCommand, tasks: list[WorkspaceTask], actor: str
) -> None:
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
    if task.status in ("done", "canceled"):
        raise TaskConflict("Reopen this task before assigning more work")
    for review in tasks:
        if review.review_of == task.id and review.status not in ("done", "canceled"):
            review.status = "canceled"
            record(review, actor, "Owner changed; previous result retained for handoff")
    task.assignee = command.assignee
    if task.assignee:
        task.breakdown_refresh = None
    task.suggestion = None
    task.suggestion_state, task.suggestion_error, task.suggestion_request_id = (
        "idle",
        "",
        "",
    )
    task.suggestion_alternatives = []
    task.status = "todo"
    task.activity = ""
    task.dispatch_state = None
    task.dispatch_message = ""
    task.dispatch_claimed_at = None
    task.last_turn_id = None
    if task.session_id:
        task.previous_session_ids.append(task.session_id)
        task.session_id = None


def _complete(task: WorkspaceTask, tasks: list[WorkspaceTask]) -> None:
    if task.schedule:
        raise TaskConflict("Complete an occurrence, not the schedule")
    if task.status == "canceled":
        raise TaskConflict("Reopen this task before submitting more work")
    if task.question and task.question.answers is None:
        raise TaskConflict(
            "Answer the outstanding question before completing this task"
        )
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
