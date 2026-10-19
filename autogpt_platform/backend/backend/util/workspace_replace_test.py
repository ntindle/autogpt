import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

from backend.data.workspace import OPENUI_MIME_TYPE, WorkspaceFile
from backend.util.workspace import WorkspaceManager
from backend.util.workspace_storage import compute_file_checksum
from backend.util.workspace_storage_local import LocalWorkspaceStorage


@pytest_asyncio.fixture
async def replacement(tmp_path, mocker):
    storage = LocalWorkspaceStorage(str(tmp_path))
    path = await storage.store("workspace", "file", "view.openui", b"old")
    now = datetime.now(UTC)
    records = [
        WorkspaceFile(
            id="file",
            workspace_id="workspace",
            name="view.openui",
            path="/view.openui",
            storage_path=path,
            mime_type=OPENUI_MIME_TYPE,
            size_bytes=3,
            checksum=compute_file_checksum(b"old"),
            metadata={},
            created_at=now,
            updated_at=now,
        )
    ]
    db = MagicMock()
    db.get_workspace_file = AsyncMock(side_effect=lambda *_: records[0])
    db.get_workspace_total_size = AsyncMock(return_value=3)

    async def publish(file_id, workspace_id, *, expected_storage_path=None, **data):
        if expected_storage_path not in (None, records[0].storage_path):
            return None
        records[0] = records[0].model_copy(update=data)
        return records[0]

    db.update_workspace_file_content = AsyncMock(side_effect=publish)
    mocker.patch("backend.util.workspace.workspace_db", return_value=db)
    mocker.patch("backend.util.workspace.get_workspace_storage", return_value=storage)
    mocker.patch("backend.util.workspace.scan_content_safe", new_callable=AsyncMock)
    mocker.patch(
        "backend.util.workspace.get_workspace_storage_limit_bytes",
        AsyncMock(return_value=0),
    )
    return WorkspaceManager("owner", "workspace"), storage, db, records


async def _replace(manager, content=b"new"):
    return await manager.replace_file_content(
        "file",
        content,
        mime_type=OPENUI_MIME_TYPE,
        metadata={"openui": {"viewId": "view"}},
    )


@pytest.mark.asyncio
async def test_rejected_replacement_preserves_original_bytes(replacement):
    manager, storage, db, records = replacement
    original = records[0]
    db.update_workspace_file_content.side_effect = RuntimeError("Database unavailable")
    with pytest.raises(RuntimeError, match="Database unavailable"):
        await _replace(manager)
    assert await storage.retrieve(original.storage_path) == b"old"
    assert records[0].checksum == compute_file_checksum(b"old")
    assert [path for path in storage.base_dir.rglob("*") if path.is_file()] == [
        storage._parse_storage_path(original.storage_path)
    ]


@pytest.mark.asyncio
async def test_lost_database_reply_keeps_committed_content(replacement):
    manager, storage, db, records = replacement
    publish = db.update_workspace_file_content.side_effect

    async def commit_then_lose_reply(*args, **kwargs):
        await publish(*args, **kwargs)
        raise RuntimeError("Reply lost")

    db.update_workspace_file_content.side_effect = commit_then_lose_reply
    with pytest.raises(RuntimeError, match="Reply lost"):
        await _replace(manager)
    assert await storage.retrieve(records[0].storage_path) == b"new"
    assert records[0].checksum == compute_file_checksum(b"new")


@pytest.mark.asyncio
async def test_concurrent_replacements_keep_matching_bytes_and_checksum(replacement):
    manager, storage, db, records = replacement
    publish = db.update_workspace_file_content.side_effect
    arrived = 0
    ready = asyncio.Event()

    async def together(*args, **kwargs):
        nonlocal arrived
        arrived += 1
        if arrived == 2:
            ready.set()
        await asyncio.wait_for(ready.wait(), timeout=10)
        return await publish(*args, **kwargs)

    db.update_workspace_file_content.side_effect = together
    results = await asyncio.gather(
        _replace(manager, b"one"), _replace(manager, b"two"), return_exceptions=True
    )
    assert sum(isinstance(result, ValueError) for result in results) == 1
    content = await storage.retrieve(records[0].storage_path)
    assert records[0].checksum == compute_file_checksum(content)
    assert len([path for path in storage.base_dir.rglob("*") if path.is_file()]) == 1


@pytest.mark.asyncio
async def test_successful_replacement_preserves_file_identity(replacement):
    manager, storage, _, records = replacement
    original = records[0]
    saved = await _replace(manager)
    assert (saved.id, saved.name, saved.path) == (
        original.id,
        original.name,
        original.path,
    )
    assert await storage.retrieve(saved.storage_path) == b"new"
    assert (
        storage._parse_storage_path(saved.storage_path)
        .relative_to(storage.base_dir)
        .parts[1]
        == "file"
    )
