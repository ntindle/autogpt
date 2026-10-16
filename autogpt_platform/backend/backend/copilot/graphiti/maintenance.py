"""Fan out account crons over persisted, independently authorized memory scopes."""

import logging
from datetime import datetime, timezone
from uuid import uuid4

from backend.copilot.dream.billing import check_dream_budget
from backend.copilot.dream.nightly_batch import (
    NightlyBatchResult,
    run_nightly_batch_submit,
)
from backend.copilot.learning.nightly import run_skill_learning_pass
from backend.data.db_accessors import memory_db
from backend.util.feature_flag import Flag, is_feature_enabled

from .communities import rebuild_communities_for_user
from .scope_resolution import memory_scope_access

logger = logging.getLogger(__name__)


async def run_all_memory_nightly(user_id: str) -> NightlyBatchResult:
    result = NightlyBatchResult(
        user_id=user_id, nightly_id=str(uuid4()), started_at=datetime.now(timezone.utc)
    )
    budget_ok, reason = await check_dream_budget(user_id)
    if not budget_ok:
        result.skipped = reason != "rate_limit_unavailable"
        result.skip_reason = reason
        result.error = "billing: rate_limit_unavailable" if not result.skipped else None
        result.completed_at = datetime.now(timezone.utc)
        result.elapsed_seconds = (
            result.completed_at - result.started_at
        ).total_seconds()
        return result
    for scope in await memory_db().list_memory_scopes(user_id):
        try:
            async with memory_scope_access(scope) as allowed:
                if not allowed:
                    continue
                outcome = await allowed.run(
                    run_nightly_batch_submit(
                        user_id,
                        organization_id=scope.organization_id,
                        expert_id=scope.expert_id,
                        include_learning=False,
                    )
                )
                result.scope_results[scope.scope_key] = outcome
                result.dream_in_flight |= outcome.dream_in_flight
                if (
                    outcome.error
                    or (outcome.dream and outcome.dream.error)
                    or (outcome.ratification and outcome.ratification.error)
                ):
                    result.error = "One or more memory maintenance scopes failed"
        except Exception:
            logger.exception("Memory maintenance failed for scope %s", scope.scope_key)
            result.error = "One or more memory maintenance scopes failed"
    try:
        if await is_feature_enabled(Flag.DREAM_SKILL_LEARNING_ENABLED, user_id):
            result.learning = await run_skill_learning_pass(user_id, trigger="nightly")
    except Exception:
        logger.exception("Nightly skill learning failed for user %s", user_id[:12])
        result.error = "Nightly skill learning failed"
    result.completed_at = datetime.now(timezone.utc)
    result.elapsed_seconds = (result.completed_at - result.started_at).total_seconds()
    return result


async def rebuild_all_memory_communities(user_id: str) -> dict:
    results: dict[str, dict] = {}
    error = None
    for scope in await memory_db().list_memory_scopes(user_id):
        try:
            async with memory_scope_access(scope) as allowed:
                if not allowed:
                    continue
                outcome = await allowed.run(
                    rebuild_communities_for_user(
                        user_id,
                        organization_id=scope.organization_id,
                        expert_id=scope.expert_id,
                    )
                )
                results[scope.scope_key] = outcome
                if outcome.get("error"):
                    error = "One or more memory rebuilds failed"
        except Exception:
            logger.exception("Memory rebuild failed for scope %s", scope.scope_key)
            error = "One or more memory rebuilds failed"
    return {"user_id": user_id, "scopes": results, "error": error}
