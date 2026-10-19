import json
import os
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from autogpt_libs.auth import RequestContext
from fastapi import HTTPException

from backend.api.features.chat.ui_drafts import get_ui_draft, save_ui_draft
from backend.api.features.orgs.db import create_org
from backend.api.features.workspace.view_state_routes import get_file_view_state
from backend.copilot.context import get_workspace_manager
from backend.copilot.db import add_chat_message, create_chat_session
from backend.copilot.tools.openui_files import PublishedView, save_view
from backend.copilot.ui_drafts import UIDraftWrite, read_draft, write_draft
from backend.copilot.ui_view_files import (
    UIDraftSaveRequest,
    UIFileStateWrite,
    read_file_state,
    save_draft_as_file,
    write_file_state,
)
from backend.data.db import prisma
from backend.data.db_accessors import LiveResourceAccessRevoked
from backend.data.openui_files import (
    find_openui_view_file,
    get_openui_file_state,
    move_chat_edits_to_file,
)
from backend.data.tenancy import (
    connect_live_transaction_lease_database,
    disconnect_live_transaction_lease_database,
)
from backend.data.workspace import OPENUI_MIME_TYPE, update_workspace_file_content
from backend.integrations.credential_scope import credential_scope
from backend.util.exceptions import NotFoundError
from backend.util.workspace_storage import LocalWorkspaceStorage

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(
        os.environ.get("RUN_ORG_ISOLATION_DB_TESTS") != "1",
        reason="Requires isolated migrated PostgreSQL and Redis",
    ),
]

SOURCE = 'root = Workspace("Trip", "", [], "trip")'


@pytest_asyncio.fixture
async def views(mocker, tmp_path):
    await prisma.connect()
    await connect_live_transaction_lease_database()
    user = await prisma.user.create(
        data={"id": str(uuid4()), "email": f"{uuid4()}@example.invalid"}
    )
    orgs = [
        await create_org(name, f"openui-{uuid4()}", user.id)
        for name in ("AutoGPT", "Denton")
    ]
    storage = LocalWorkspaceStorage(str(tmp_path))
    mocker.patch("backend.util.workspace.get_workspace_storage", return_value=storage)
    mocker.patch(
        "backend.copilot.ui_view_files.get_workspace_storage", return_value=storage
    )
    mocker.patch("backend.util.workspace.scan_content_safe", AsyncMock())
    mocker.patch(
        "backend.util.workspace.get_workspace_storage_limit_bytes",
        AsyncMock(return_value=0),
    )
    sessions = []
    scopes = []
    for org in orgs:
        team = await prisma.team.find_first(where={"orgId": org.id, "isDefault": True})
        assert team is not None
        scope = {"organization_id": org.id, "team_id": team.id}
        session = await create_chat_session(str(uuid4()), user.id, **scope)
        await add_chat_message(
            session.session_id,
            "tool",
            1,
            tool_call_id="view-one",
            content=json.dumps(
                {"type": "ui_rendered", "view_id": "trip", "source": SOURCE}
            ),
        )
        scopes.append(scope)
        sessions.append(session.session_id)
    try:
        yield user.id, sessions, scopes, storage
    finally:
        await prisma.user.delete(where={"id": user.id})
        await prisma.organization.delete_many(
            where={"id": {"in": [org.id for org in orgs]}}
        )
        await disconnect_live_transaction_lease_database()
        await prisma.disconnect()


def _ctx(user, scope):
    return RequestContext(
        user_id=user,
        org_id=scope["organization_id"],
        team_id=scope["team_id"],
        is_org_owner=True,
        is_org_admin=True,
        is_org_billing_manager=False,
        is_team_admin=True,
        is_team_billing_manager=False,
        seat_status="ACTIVE",
    )


def _draft(value):
    return UIDraftWrite(
        tool_call_id="view-one", expected_revision=0, state={"choice": value}
    )


async def test_selected_org_cannot_read_or_write_another_saved_chat(views):
    user, (a, b), (scope_a, scope_b), _ = views
    await save_ui_draft(a, "trip", user, _draft("A"), _ctx(user, scope_a))
    await save_ui_draft(b, "trip", user, _draft("B"), _ctx(user, scope_b))
    assert (
        await get_ui_draft(a, "trip", user, "view-one", _ctx(user, scope_a))
    ).state == {"choice": "A"}
    for operation in (
        get_ui_draft(a, "trip", user, "view-one", _ctx(user, scope_b)),
        save_ui_draft(a, "trip", user, _draft("B"), _ctx(user, scope_b)),
    ):
        with pytest.raises(NotFoundError):
            await operation
    with pytest.raises(HTTPException) as error:
        await read_draft(str(uuid4()), a, "trip", "view-one")
    assert error.value.status_code == 404


async def test_saved_file_state_and_compare_and_swap_are_scoped(views):
    user, (a, b), (scope_a, scope_b), storage = views
    await write_draft(user, a, "trip", _draft("A"))
    saved_a = await save_draft_as_file(
        user, a, "trip", UIDraftSaveRequest(filename="Trip")
    )
    saved_b = await save_draft_as_file(
        user, b, "trip", UIDraftSaveRequest(filename="Trip")
    )
    assert saved_a.file_id != saved_b.file_id
    state = await get_file_view_state(saved_a.file_id, user, _ctx(user, scope_a))
    assert (state.organization_id, state.team_id) == (
        scope_a["organization_id"],
        scope_a["team_id"],
    )
    assert state.state == {"choice": "A"}
    assert state.origin_session_id == a
    for operation in (
        read_file_state(user, saved_a.file_id, **scope_b),
        write_file_state(
            user,
            saved_a.file_id,
            UIFileStateWrite(
                expected_revision=1, expected_checksum=state.checksum, state={}
            ),
            **scope_b,
        ),
    ):
        with pytest.raises(HTTPException) as error:
            await operation
        assert error.value.status_code == 404
    file = await prisma.userworkspacefile.find_unique(where={"id": saved_a.file_id})
    assert file is not None
    assert (
        await update_workspace_file_content(
            file.id,
            file.workspaceId,
            expected_storage_path=file.storagePath,
            storage_path="wrong",
            mime_type=OPENUI_MIME_TYPE,
            size_bytes=5,
            checksum="wrong",
            metadata={},
            **scope_b,
        )
        is None
    )
    assert await storage.retrieve(file.storagePath) == SOURCE.encode()
    assert await get_openui_file_state(user, file.id, **scope_b) is None
    assert await get_openui_file_state(user, file.id) is None
    assert await find_openui_view_file(user, a, "trip") is None
    assert await get_openui_file_state(user, file.id, **scope_a) == {"choice": "A"}


async def test_orphaned_files_remain_private_and_foreign_origins_are_hidden(views):
    user, (a, b), (scope_a, _), _storage = views
    saved = await save_draft_as_file(
        user, a, "trip", UIDraftSaveRequest(filename="Trip")
    )
    await prisma.userworkspacefile.update(
        where={"id": saved.file_id},
        data={
            "metadata": json.dumps({"openui": {"viewId": "trip", "originSessionId": b}})
        },
    )
    assert (
        await read_file_state(user, saved.file_id, **scope_a)
    ).origin_session_id is None
    await prisma.userworkspacefile.update(
        where={"id": saved.file_id},
        data={
            "metadata": json.dumps({"openui": {"viewId": "trip", "originSessionId": a}})
        },
    )
    await prisma.chatsession.delete(where={"id": a})
    state = await write_file_state(
        user,
        saved.file_id,
        UIFileStateWrite(
            expected_revision=0,
            expected_checksum=saved.checksum,
            state={"after": "deletion"},
        ),
        **scope_a,
    )
    assert state.origin_session_id is None
    assert state.state == {"after": "deletion"}


async def test_chat_edits_cannot_move_into_a_different_org(views):
    user, (a, b), (scope_a, scope_b), _ = views
    await write_draft(user, a, "trip", _draft("A"))
    saved = await save_draft_as_file(
        user, b, "trip", UIDraftSaveRequest(filename="Trip")
    )
    assert not await move_chat_edits_to_file(user, a, "trip", saved.file_id, **scope_a)
    assert not await move_chat_edits_to_file(user, a, "trip", saved.file_id, **scope_b)
    assert await find_openui_view_file(user, a, "trip", **scope_b) is None
    assert (await read_draft(user, a, "trip", "view-one")).state == {"choice": "A"}


@pytest.mark.parametrize("revoke", ["org", "team"])
async def test_revoked_saved_scope_rejects_known_ids_and_worker_reload(views, revoke):
    user, (a, _), (scope_a, scope_b), storage = views
    saved = await save_draft_as_file(
        user, a, "trip", UIDraftSaveRequest(filename="Trip")
    )
    if revoke == "org":
        await prisma.orgmember.update_many(
            where={"userId": user, "orgId": scope_a["organization_id"]},
            data={"status": "SUSPENDED"},
        )
    else:
        await prisma.teammember.delete_many(
            where={"userId": user, "teamId": scope_a["team_id"]}
        )
    for operation in (
        read_draft(user, a, "trip", "view-one"),
        write_draft(user, a, "trip", _draft("changed")),
        save_draft_as_file(user, a, "trip", UIDraftSaveRequest(filename="Other")),
        read_file_state(user, saved.file_id, **scope_a),
        write_file_state(
            user,
            saved.file_id,
            UIFileStateWrite(
                expected_revision=0, expected_checksum=saved.checksum, state={}
            ),
            **scope_a,
        ),
    ):
        with pytest.raises(HTTPException) as error:
            await operation
        assert error.value.status_code == 404
    before = sorted(storage.base_dir.rglob("*.blob"))
    with (
        credential_scope(scope_b["organization_id"]),
        pytest.raises(LiveResourceAccessRevoked),
    ):
        await save_view(
            user,
            a,
            source=SOURCE,
            view=PublishedView(view_id="trip", summary="Trip"),
            file=saved.file_id,
        )
    assert sorted(storage.base_dir.rglob("*.blob")) == before


async def test_worker_reloads_saved_org_after_navigation_and_replaces_in_place(views):
    user, (a, _), (scope_a, scope_b), _storage = views
    with credential_scope(scope_b["organization_id"]):
        saved = await save_view(
            user,
            a,
            source=SOURCE,
            view=PublishedView(view_id="trip", summary="Trip"),
            file="Trip",
        )
    assert saved is not None and saved.organization_id == scope_a["organization_id"]
    revised_source = SOURCE.replace("Trip", "Updated")
    with credential_scope(scope_b["organization_id"]):
        revised = await save_view(
            user,
            a,
            source=revised_source,
            view=PublishedView(view_id="trip", summary="Updated"),
            file=None,
        )
    assert revised is not None and revised.id == saved.id
    assert revised.organization_id == scope_a["organization_id"]
    assert (await read_file_state(user, saved.id, **scope_a)).source == revised_source
    manager_b = await get_workspace_manager(user, views[1][1])
    with pytest.raises(FileNotFoundError):
        await manager_b.replace_file_content(
            saved.id, b"foreign", mime_type=OPENUI_MIME_TYPE, metadata={}
        )
