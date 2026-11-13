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
