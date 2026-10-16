"""Trusted request/worker scope for private connections, never navigation state.

None means the original personal organization, including old persisted jobs.
The store passes this value explicitly over DB RPC; ContextVars never cross it.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from enum import Enum


class CurrentCredentialScope(Enum):
    CURRENT = "current"


_organization_id: ContextVar[str | None] = ContextVar(
    "credential_organization_id", default=None
)


def credential_organization_id() -> str | None:
    return _organization_id.get()


@contextmanager
def credential_scope(organization_id: str | None) -> Iterator[None]:
    token = _organization_id.set(organization_id)
    try:
        yield
    finally:
        _organization_id.reset(token)
