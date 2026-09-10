from uuid import uuid4

import pytest_asyncio

from backend.data import db


@pytest_asyncio.fixture
async def owner():
    await db.connect()
    user_id = str(uuid4())
    await db.prisma.user.create(
        data={"id": user_id, "email": f"{user_id}@tasks.example.invalid"}
    )
    yield user_id
    await db.prisma.user.delete(where={"id": user_id})
    await db.disconnect()
