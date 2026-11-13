import inspect
from unittest.mock import AsyncMock, patch

import pytest

from backend.data.db_manager import DatabaseManager


@pytest.mark.asyncio
async def test_saved_view_lookup_crosses_rpc_without_a_database_client() -> None:
    manager = DatabaseManager()
    endpoint = manager._create_fastapi_endpoint(
        DatabaseManager.__dict__["find_openui_view_file"]
    )
    body_model = inspect.signature(endpoint).parameters["body"].annotation
    assert "client" not in body_model.model_fields
    body = body_model.model_validate(
        {"user_id": "owner", "session_id": "chat", "view_id": "view"}
    )
    with patch(
        "backend.data.db_manager.find_openui_view_file",
        new=AsyncMock(return_value="saved-file"),
    ) as lookup:
        assert await endpoint(body) == "saved-file"
    assert lookup.await_args.args == ("owner", "chat", "view")
    assert "client" not in lookup.await_args.kwargs


@pytest.mark.asyncio
async def test_saved_view_rpc_preserves_organization_and_team() -> None:
    endpoint = DatabaseManager()._create_fastapi_endpoint(
        DatabaseManager.__dict__["find_openui_view_file"]
    )
    body_model = inspect.signature(endpoint).parameters["body"].annotation
    body = body_model.model_validate(
        {
            "user_id": "owner",
            "session_id": "chat",
            "view_id": "view",
            "organization_id": "saved-org",
            "team_id": "saved-team",
        }
    )
    with patch(
        "backend.data.db_manager.find_openui_view_file",
        new=AsyncMock(return_value="saved-file"),
    ) as lookup:
        assert await endpoint(body) == "saved-file"
    lookup.assert_awaited_once_with(
        "owner", "chat", "view", organization_id="saved-org", team_id="saved-team"
    )


def test_database_service_builds_with_saved_view_routes() -> None:
    app = DatabaseManager().build_fastapi_app()
    assert "/find_openui_view_file" in app.openapi()["paths"]
