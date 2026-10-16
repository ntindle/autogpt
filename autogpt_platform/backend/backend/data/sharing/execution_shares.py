"""When a shared agent run stops being public.

A run's public page and its file links follow one rule, kept here so the two
cannot drift apart: the run is still shared, it is not deleted, and a run
shared as part of a chat (``CHAT_LINK``) is still linked from a shared chat.
Anything else answers like an unknown token.

Deleting a run ends its share in the same transaction, so a deleted run
leaves no token, file allowlist or chat link behind.
"""

from prisma import Prisma
from prisma.enums import SharedVia
from prisma.models import AgentGraphExecution, ChatLinkedShare, SharedExecutionFile
from prisma.types import AgentGraphExecutionWhereInput

from backend.data.db import transaction


def live_execution_share(share_token: str) -> AgentGraphExecutionWhereInput:
    """Where-clause for a run whose share link may still be served."""
    return {
        "shareToken": share_token,
        "isShared": True,
        "isDeleted": False,
        "OR": [
            {"sharedVia": SharedVia.USER},
            {"ChatLinkedShares": {"some": {"Session": {"is": {"isShared": True}}}}},
        ],
    }


async def soft_delete_and_unshare_execution(
    execution_id: str,
    user_id: str,
    *,
    organization_id: str | None = None,
    team_id: str | None = None,
    exact_scope: bool = False
) -> int:
    """Mark the user's run deleted and end its share.

    Returns how many runs were deleted: 0 when *execution_id* is not the
    user's, in which case nothing else is touched.
    """
    where: AgentGraphExecutionWhereInput = {"id": execution_id, "userId": user_id}
    if exact_scope or organization_id is not None:
        where["organizationId"] = organization_id
        if exact_scope or team_id is not None:
            where["teamId"] = team_id
    async with transaction() as tx:
        deleted = await AgentGraphExecution.prisma(tx).update_many(
            where=where,
            data={
                "isDeleted": True,
                "isShared": False,
                "shareToken": None,
                "sharedAt": None,
                "sharedVia": None,
            },
        )
        if deleted:
            await _delete_share_rows(execution_id, tx)
    return deleted


async def _delete_share_rows(execution_id: str, tx: Prisma) -> None:
    await SharedExecutionFile.prisma(tx).delete_many(
        where={"executionId": execution_id}
    )
    await ChatLinkedShare.prisma(tx).delete_many(where={"executionId": execution_id})
