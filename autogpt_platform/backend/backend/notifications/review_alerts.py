"""Keeping the "waiting on your review" alert in step with reality.

This is one of the conditions the notification surface this replaces could not
report at all: an agent holding outputs that nothing will send until a human
approves or dismisses them. Because it is a *state* rather than an event, the
alert is re-derived from the live count every time the queue changes — so
approving the last item resolves the condition instead of leaving a stale alert
behind.
"""

import logging

from prisma.enums import AlertCause, ReviewStatus
from prisma.models import PendingHumanReview
from prisma.types import PendingHumanReviewWhereInput

from backend.api.features.library.db import get_library_agent_id_by_graph_id
from backend.copilot.constants import AUTOPILOT_NAME, COPILOT_SESSION_PREFIX
from backend.data import alerts as alerts_db
from backend.data.graph import get_graph_metadata
from backend.notifications.alert_causes import AwaitingReviewCause
from backend.util.logging import TruncatedLogger
from backend.util.tenancy_urls import builder_path, copilot_path, library_agent_path

logger = TruncatedLogger(logging.getLogger(__name__), prefix="[ReviewAlerts]")


async def sync_awaiting_review(
    user_id: str,
    graph_id: str | None = None,
    graph_exec_id: str | None = None,
    *,
    chat_session_id: str | None = None,
) -> None:
    """Raise, update or clear the review-queue alert for one agent or one chat.

    Never raises: a notification must not fail the review flow that triggered
    it.
    """
    scope = f"chat {chat_session_id}" if chat_session_id else f"agent {graph_id}"
    try:
        if chat_session_id:
            where: PendingHumanReviewWhereInput = {
                "OR": [
                    {"chatSessionId": chat_session_id},
                    # Rows an older deploy wrote in the synthetic-graph shape.
                    {"graphExecId": f"{COPILOT_SESSION_PREFIX}{chat_session_id}"},
                ]
            }
            cause_key = f"awaiting_review:chat:{chat_session_id}"
            # The alert an older deploy raised for this chat, keyed as an agent.
            await alerts_db.resolve_alert_condition(
                user_id, f"awaiting_review:{COPILOT_SESSION_PREFIX}{chat_session_id}"
            )
        elif graph_id:
            where = {"graphId": graph_id}
            if graph_exec_id:
                where["graphExecId"] = graph_exec_id
            cause_key = f"awaiting_review:{graph_exec_id or graph_id}"
        else:
            return
        where["userId"] = user_id
        where["status"] = ReviewStatus.WAITING
        waiting = await PendingHumanReview.prisma().find_many(
            where=where,
            order={"createdAt": "asc"},
        )
        if not waiting:
            await alerts_db.resolve_alert_condition(user_id, cause_key)
            return

        oldest = waiting[0].createdAt
        tenant_scopes = {(row.organizationId, row.teamId) for row in waiting}
        if len(tenant_scopes) != 1:
            raise ValueError("Pending reviews for one alert have mixed scopes")
        organization_id, team_id = next(iter(tenant_scopes))
        if chat_session_id:
            agent_name = AUTOPILOT_NAME
            cta_path = copilot_path(chat_session_id, organization_id, team_id)
        else:
            assert graph_id
            metadata = await get_graph_metadata(graph_id=graph_id)
            agent_name = f"Workflow {graph_id[:8]}"
            if metadata is not None and (
                metadata.organization_id,
                metadata.team_id,
            ) == (organization_id, team_id):
                agent_name = metadata.name or agent_name
            library_agent_id = await get_library_agent_id_by_graph_id(
                user_id,
                graph_id,
                organization_id,
                team_id,
            )
            if library_agent_id:
                cta_path = library_agent_path(
                    library_agent_id,
                    organization_id,
                    team_id,
                    active_tab="runs",
                    active_item=graph_exec_id,
                )
            else:
                cta_path = builder_path(
                    graph_id,
                    waiting[0].graphVersion,
                    organization_id,
                    team_id,
                    execution_id=graph_exec_id,
                )
        cause = AwaitingReviewCause(
            cta_path=cta_path,
            agent=agent_name,
            count=len(waiting),
            since_label=f"{oldest.day} {oldest.strftime('%b %Y')}, {oldest.strftime('%H:%M')} UTC",
        )
        await alerts_db.raise_alert_condition(
            user_id=user_id,
            cause=AlertCause.AWAITING_REVIEW,
            cause_key=cause_key,
            data=cause.model_dump(mode="json"),
            organization_id=organization_id,
            team_id=team_id,
            source_graph_execution_id=graph_exec_id,
        )
    except Exception:
        logger.warning(
            f"Could not sync the awaiting-review alert for user {user_id} {scope}",
            exc_info=True,
        )
