import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest

from backend.api.features.tasks.context import execution_context
from backend.api.features.tasks.decomposition import ProposedBreakdown, resolve_steps
from backend.api.features.tasks.domain import TaskConflict, check_structure, is_runnable
from backend.api.features.tasks.models import TaskAssignee, WorkspaceTask
from backend.api.features.tasks.planning_model import planning_completion
from backend.api.features.tasks.recommendations import (
    OwnerRecommendation,
    generate_task_suggestion,
)
from backend.util.llm.providers import ProviderResponse

AUTO = TaskAssignee(kind="auto", id="auto", name="Auto")
DESIGNER = TaskAssignee(
    kind="expert",
    id="grid-expert",
    name="Grid specialist",
    role="3D fabrication",
    color="mint",
)
MARKETER = TaskAssignee(kind="expert", id="sales-expert", name="Sales strategist")


def task(**kwargs):
    return WorkspaceTask(user_id="owner", title="Set up sample kits", **kwargs)


def test_autopilot_is_the_existing_identity_even_for_legacy_payloads():
    assert AUTO.name == "AutoPilot" and AUTO.id == "auto"


@pytest.mark.asyncio
async def test_semantic_routing_uses_the_configured_model_and_actual_context():
    parent = task(
        id="parent", description="Needlepoint sample kits selected from customer orders"
    )
    child = WorkspaceTask(
        user_id="owner",
        id="child",
        title="Layout the grid",
        parent_id=parent.id,
        project="Needlepoint",
    )
    db = AsyncMock()
    db.list_workspace_tasks.return_value = [parent, child]
    output = OwnerRecommendation.model_validate(
        {
            "choice": {
                "assignee_id": DESIGNER.id,
                "reason": "Their fabrication skills match this needlepoint grid.",
            },
            "alternatives": [
                {
                    "assignee_id": "auto",
                    "reason": "Can coordinate if the scope spans multiple specialties.",
                }
            ],
        }
    )
    with patch(
        "backend.api.features.tasks.recommendations.tasks_db", return_value=db
    ), patch(
        "backend.api.features.tasks.recommendations.planning_roster",
        AsyncMock(return_value=([AUTO, DESIGNER, MARKETER], [])),
    ), patch(
        "backend.api.features.tasks.recommendations.planning_completion",
        AsyncMock(return_value=output),
    ) as model:
        await generate_task_suggestion("owner", child)
    context = model.call_args.args[1]
    assert context["ancestors"][0]["description"] == parent.description
    assert context["task"]["project"] == "Needlepoint"
    selected = db.finish_workspace_task_suggestion.call_args.args[3]
    assert selected.id == DESIGNER.id and selected.name == DESIGNER.name
    assert selected.color == "mint"
    db.command_workspace_task.assert_not_called()


@pytest.mark.asyncio
async def test_model_failure_is_visible_and_never_fakes_an_autopilot_recommendation():
    item = task()
    db = AsyncMock()
    db.list_workspace_tasks.return_value = [item]
    with patch(
        "backend.api.features.tasks.recommendations.tasks_db", return_value=db
    ), patch(
        "backend.api.features.tasks.recommendations.planning_roster",
        AsyncMock(side_effect=RuntimeError("offline")),
    ):
        await generate_task_suggestion("owner", item)
    args = db.finish_workspace_task_suggestion.call_args.args
    assert args[3] is None and args[4] == [] and "configured model" in args[5]


def test_breakdown_resolves_real_experts_and_retains_dependency_order():
    plan = ProposedBreakdown.model_validate(
        {
            "steps": [
                {
                    "key": "product",
                    "title": "Choose kit contents",
                    "description": "Use order history to select products",
                    "assignee_id": MARKETER.id,
                    "reason": "Understands customer demand",
                },
                {
                    "key": "grid",
                    "title": "Design the grid",
                    "description": "Fit the approved contents",
                    "assignee_id": DESIGNER.id,
                    "reason": "Owns 3D design",
                    "depends_on": ["product"],
                },
            ]
        }
    )
    steps = resolve_steps(plan, [AUTO, DESIGNER, MARKETER], "preview")
    assert steps[0].suggestion.id == MARKETER.id
    assert steps[1].suggestion.id == DESIGNER.id
    assert steps[1].dependencies == [steps[0].id]
    assert resolve_steps(plan, [AUTO, DESIGNER, MARKETER], "preview") == steps
    plan.steps[0].assignee_id = "another-users-expert"
    with pytest.raises(ValueError, match="unavailable"):
        resolve_steps(plan, [AUTO, DESIGNER, MARKETER], "preview")


def test_full_context_and_inherited_dependencies_follow_nested_work():
    prerequisite = task(id="kit-selection")
    root = task(
        id="root",
        description="Needlepoint kits, business constraints",
        dependencies=[prerequisite.id],
        assignee=AUTO,
    )
    child = WorkspaceTask(
        user_id="owner", title="Grid design", parent_id=root.id, assignee=DESIGNER
    )
    tasks = [prerequisite, root, child]
    assert not is_runnable(child, tasks)
    prerequisite.status = "done"
    prerequisite.result = "Approved kit contents: blue thread and a small canvas"
    assert is_runnable(child, tasks)
    context = execution_context(child, tasks)
    assert "Needlepoint kits, business constraints" in context
    assert "AutoPilot retains ownership" in context
    assert prerequisite.result in context
    root.dependencies = [child.id]
    with pytest.raises(TaskConflict):
        check_structure(child, tasks)


@pytest.mark.asyncio
async def test_planning_uses_configured_transport_and_model():
    from types import SimpleNamespace

    response = ProviderResponse(
        content=json.dumps(
            {"choice": {"assignee_id": "auto", "reason": "Coordinates the team"}}
        ),
        prompt_tokens=20,
        completion_tokens=15,
    )
    with patch(
        "backend.api.features.tasks.planning_model.routing_kwargs_for_chat_transport",
        return_value=SimpleNamespace(
            provider="openrouter", api_key="test-key", base_url=None
        ),
    ), patch(
        "backend.api.features.tasks.planning_model.ChatConfig",
        return_value=SimpleNamespace(fast_standard_model="configured-model"),
    ), patch(
        "backend.api.features.tasks.planning_model.call_provider",
        AsyncMock(return_value=response),
    ) as provider:
        result = await planning_completion(
            "Choose an owner", {"task": "sample kits"}, OwnerRecommendation
        )
    assert result.choice.assignee_id == "auto"
    assert provider.call_args.kwargs["model"] == "configured-model"
    assert provider.call_args.kwargs["api_key"] == "test-key"
    assert provider.call_args.kwargs["provider"] == "openrouter"


@pytest.mark.asyncio
async def test_question_follows_preserved_task_even_when_session_metadata_is_cached():
    from backend.copilot.model import ChatSession, ChatSessionMetadata
    from backend.copilot.tools.ask_question import AskQuestionTool

    session = ChatSession(
        session_id="preserved-chat",
        user_id="owner",
        started_at=datetime.now(UTC),
        usage=[],
        updated_at=datetime.now(UTC),
        messages=[],
        metadata=ChatSessionMetadata(workspace_task_id="old-parent"),
    )
    preserved = task(id="preserved-child")

    async def persist(*args, **kwargs):
        preserved.question = kwargs["question"]
        return preserved

    database = AsyncMock()
    database.workspace_task_run_event.side_effect = persist
    with patch(
        "backend.copilot.tools.ask_question.tasks_db", return_value=database
    ), patch("backend.copilot.tools.ask_question._mark_pending", AsyncMock()):
        response = await AskQuestionTool()._execute(
            "owner",
            session,
            questions=[
                {
                    "question": "Which size?",
                    "keyword": "size",
                    "options": ["Small", "Large"],
                }
            ],
        )
    assert response.task_id == preserved.id
    assert response.task_question_id == preserved.question.id
