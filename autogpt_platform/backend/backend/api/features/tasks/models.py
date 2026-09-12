from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

TaskStatus = Literal["todo", "working", "needs_you", "blocked", "done", "canceled"]


class TaskAssignee(BaseModel):
    kind: Literal["human", "auto", "expert"]
    id: str
    name: str
    avatar_url: str | None = None
    reason: str | None = None
    role: str | None = None
    color: str | None = None

    @model_validator(mode="after")
    def autopilot_identity(self) -> "TaskAssignee":
        if self.kind == "auto":
            self.id, self.name = "auto", "AutoPilot"
        return self


class TaskQuestionItem(BaseModel):
    question: str
    keyword: str
    options: list[str] = Field(default_factory=list)


class TaskQuestion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    questions: list[TaskQuestionItem]
    answers: dict[str, str] | None = None
    answered_by: str | None = None
    asked_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def normalize_question_keys(self) -> "TaskQuestion":
        seen: set[str] = set()
        for index, question in enumerate(self.questions):
            keyword = question.keyword.strip().lower() or f"question-{index}"
            unique = keyword
            suffix = 1
            while unique in seen:
                unique = f"{keyword}-{suffix}"
                suffix += 1
            question.keyword = unique
            seen.add(unique)
        return self


class TaskEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    actor: str
    text: str


class TaskSchedule(BaseModel):
    id: str | None = None
    cron: str | None = None
    run_at: datetime | None = None
    timezone: str = "UTC"
    paused: bool = False
    next_run: str | None = None


class TaskBreakdownStep(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=20000)
    suggestion: TaskAssignee | None = None
    dependencies: list[str] = Field(default_factory=list)


class TaskBreakdownSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=20000)
    assignee: TaskAssignee | None = None

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, title: str) -> str:
        if not title.strip():
            raise ValueError("A step needs a title")
        return title.strip()


class TaskBreakdownRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: Literal["milestones", "steps", "small_steps"] = "steps"
    guidance: str = Field(default="", max_length=2000)
    preview_id: str | None = None
    current_steps: list[TaskBreakdownSelection] | None = Field(
        default=None, min_length=1, max_length=12
    )


class TaskBreakdown(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    context: str
    started_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    detail: Literal["milestones", "steps", "small_steps"] = "steps"
    guidance: str = ""
    state: Literal["pending", "ready", "error", "accepted"] = "pending"
    error: str = ""
    steps: list[TaskBreakdownStep] = Field(default_factory=list)


class TaskBreakdownAccept(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preview_id: str
    steps: list[TaskBreakdownSelection] = Field(min_length=1, max_length=12)


class WorkspaceTask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str
    organization_id: str | None = None
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=20000)
    project: str = Field(default="", max_length=100)
    parent_id: str | None = None
    required: bool = True
    accepted: bool = True
    status: TaskStatus = "todo"
    activity: str = ""
    assignee: TaskAssignee | None = None
    suggestion: TaskAssignee | None = None
    suggestion_state: Literal["idle", "pending", "ready", "error"] = "idle"
    suggestion_error: str = ""
    suggestion_started_at: datetime | None = None
    suggestion_request_id: str = ""
    suggestion_context: str = ""
    suggestion_alternatives: list[TaskAssignee] = Field(default_factory=list)
    breakdown: TaskBreakdown | None = None
    breakdown_refresh: TaskBreakdown | None = None
    plan_only: bool = False
    execution_enabled: bool = False
    paused: bool = False
    dependencies: list[str] = Field(default_factory=list)
    session_id: str | None = None
    source_session_id: str | None = None
    previous_session_ids: list[str] = Field(default_factory=list)
    started_turn_ids: list[str] = Field(default_factory=list)
    last_turn_id: str | None = None
    coordination_state: str = ""
    dispatch_id: str | None = None
    dispatch_state: Literal["pending", "claimed", "sent", "finished"] | None = None
    dispatch_claimed_at: datetime | None = None
    dispatch_message: str = ""
    question: TaskQuestion | None = None
    result: str | None = None
    review_of: str | None = None
    review_version: int | None = None
    result_version: int = 0
    schedule: TaskSchedule | None = None
    occurrence_of: str | None = None
    source_url: str | None = None
    events: list[TaskEvent] = Field(default_factory=list)
    version: int = 1
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def display_self_as_you(self) -> "WorkspaceTask":
        self.assignee = _self_identity(self.assignee, self.user_id)
        self.suggestion = _self_identity(self.suggestion, self.user_id)
        self.suggestion_alternatives = [
            _self_identity(assignee, self.user_id) or assignee
            for assignee in self.suggestion_alternatives
        ]
        for preview in (self.breakdown, self.breakdown_refresh):
            if preview:
                if "started_at" not in preview.model_fields_set:
                    preview.started_at = self.updated_at
                for step in preview.steps:
                    step.suggestion = _self_identity(step.suggestion, self.user_id)
        return self


def _self_identity(assignee: TaskAssignee | None, user_id: str) -> TaskAssignee | None:
    if assignee and assignee.kind == "human" and assignee.id == user_id:
        return assignee.model_copy(update={"name": "You"})
    return assignee


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=20000)
    project: str = Field(default="", max_length=100)
    parent_id: str | None = None
    plan_only: bool = False

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, title: str) -> str:
        if not title.strip():
            raise ValueError("A task needs a title")
        return title.strip()


class TaskCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation: Literal[
        "edit",
        "reparent",
        "submit_result",
        "assign",
        "suggest",
        "complete",
        "reopen",
        "cancel",
        "hold",
        "activate",
        "start",
        "pause",
        "resume",
        "retry",
        "answer",
        "accept_scope",
        "accept_result",
        "request_changes",
        "discuss",
    ]
    version: int
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=20000)
    project: str | None = Field(default=None, max_length=100)
    assignee: TaskAssignee | None = None
    parent_id: str | None = None
    dependencies: list[str] | None = None
    question_id: str | None = None
    answers: dict[str, str] | None = None
    feedback: str = Field(default="", max_length=10000)
    evidence: str = Field(default="", max_length=20000)


class TaskListResponse(BaseModel):
    tasks: list[WorkspaceTask]
    assignees: list[TaskAssignee]


class TaskContextResponse(BaseModel):
    task: WorkspaceTask
    ancestors: list[WorkspaceTask]
    children: list[WorkspaceTask]
