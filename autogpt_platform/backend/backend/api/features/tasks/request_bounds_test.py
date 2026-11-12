import pytest
from pydantic import ValidationError

from backend.api.features.tasks.models import TaskBreakdownRequest, TaskCreate
from backend.api.features.tasks.schedules import TaskScheduleRequest


@pytest.mark.parametrize(
    "model,field,base",
    [
        (TaskCreate, "id", {"title": "Review the week"}),
        (TaskCreate, "parent_id", {"title": "Review the week"}),
        (TaskBreakdownRequest, "preview_id", {}),
        (TaskScheduleRequest, "cron", {"version": 1}),
    ],
)
def test_task_request_rejects_oversized_identifiers_and_cadences(model, field, base):
    with pytest.raises(ValidationError) as error:
        model.model_validate({**base, field: "x" * 257})
    assert error.value.errors()[0]["loc"] == (field,)
    assert error.value.errors()[0]["type"] == "string_too_long"


def test_task_request_keeps_generated_ids_and_recurring_schedules():
    request = TaskCreate(title="Review the week")
    assert len(request.id) == 36
    assert TaskBreakdownRequest().preview_id is None
    schedule = TaskScheduleRequest(version=1, cron="0 9 * * 1")
    assert schedule.cron == "0 9 * * 1"
