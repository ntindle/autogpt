from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import SecretStr

from backend.data import user
from backend.data.model import APIKeyCredentials


def credential(identifier: str) -> APIKeyCredentials:
    return APIKeyCredentials(
        id=identifier, provider="github", api_key=SecretStr("fake-test-token")
    )


@pytest.fixture
def credential_db(monkeypatch):
    rows = {
        name: SimpleNamespace(
            id=name,
            ownerType="USER",
            ownerId="owner" if name != "other-user" else "other",
            organizationId="personal" if name == "legacy" else "business",
            status="active",
            encryptedPayload=user.JSONCryptor().encrypt(credential(name).model_dump()),
        )
        for name in ["legacy", "business-key", "other-user"]
    }

    async def find_many(*, where, **kwargs):
        return [
            row
            for row in rows.values()
            if all(getattr(row, key) == value for key, value in where.items())
        ]

    async def update(*, where, data):
        row = rows[where["id"]]
        for key, value in data.items():
            setattr(row, key, value)
        return row

    async def create(*, data):
        assert data["id"] not in rows
        rows[data["id"]] = SimpleNamespace(status="active", **data)

    db = SimpleNamespace(
        integrationcredential=SimpleNamespace(
            find_many=AsyncMock(side_effect=find_many),
            update=AsyncMock(side_effect=update),
            create=AsyncMock(side_effect=create),
        ),
        organization=SimpleNamespace(
            find_first=AsyncMock(return_value=SimpleNamespace(id="personal"))
        ),
        execute_raw=AsyncMock(),
    )

    @asynccontextmanager
    async def transaction():
        yield db

    monkeypatch.setattr(user, "prisma", db)
    monkeypatch.setattr(user, "transaction", transaction)
    return rows, db


@pytest.mark.asyncio
async def test_read_is_owner_and_organization_scoped(credential_db):
    assert {c.id for c in await user.get_user_credentials("owner")} == {"legacy"}
    assert {c.id for c in await user.get_user_credentials("owner", "business")} == {
        "business-key"
    }


@pytest.mark.asyncio
async def test_replace_never_revokes_another_org_or_owner(credential_db):
    rows, _ = credential_db
    await user.set_user_credentials("owner", [credential("new-key")], "business")
    assert rows["legacy"].status == "active"
    assert rows["other-user"].status == "active"
    assert rows["business-key"].status == "revoked"
    assert rows["new-key"].organizationId == "business"


@pytest.mark.asyncio
async def test_foreign_id_cannot_be_updated_or_moved(credential_db):
    rows, db = credential_db
    with pytest.raises((ValueError, AssertionError)):
        await user.set_user_credentials("owner", [credential("business-key")])
    db.integrationcredential.update.assert_not_awaited()
    assert rows["business-key"].organizationId == "business"
