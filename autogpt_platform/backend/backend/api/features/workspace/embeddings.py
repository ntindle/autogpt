"""Cleanup for legacy workspace-file embeddings."""

import logging

from prisma.enums import ContentType

from backend.data.db_accessors import embeddings_db

logger = logging.getLogger(__name__)


async def delete_workspace_file_embedding(file_id: str, user_id: str) -> None:
    try:
        await embeddings_db().delete_content_embedding(
            ContentType.WORKSPACE_FILE, file_id, user_id=user_id
        )
    except Exception as error:
        logger.warning(
            "Failed to delete workspace file embedding for %s: %s", file_id, error
        )
