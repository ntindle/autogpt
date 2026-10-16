import type { PendingHumanReviewModel } from "@/app/api/__generated__/models/pendingHumanReviewModel";
import {
  getCopilotHref,
  getLibraryAgentHref,
} from "@/services/org-team/builder";

/**
 * Deep link to wherever a pending human review can be acted on.
 *
 * Lives here rather than next to a component so review surfaces (copilot
 * home, thread, library) share one definition of these routes instead of
 * each embedding path literals.
 *
 * `session_id` is set on every chat review; `library_agent_id` comes from
 * the backend's enrichment of reviews raised by a real graph execution.
 *
 * The library route selects a run via `activeTab`/`activeItem` — those are
 * the params `NewAgentLibraryView` actually parses, so anything else lands
 * on the agent page without opening the run.
 *
 * The morning briefing composes these same two routes server-side, in
 * `backend/copilot/briefing/generate.py` (`_run_link` and the decision-link
 * branch of `compose_briefing`) — change both together.
 */
export function getReviewLink(review: PendingHumanReviewModel): string {
  if (review.session_id) {
    return getCopilotHref(
      review.session_id,
      review.organization_id ?? null,
      review.team_id ?? null,
    );
  }
  if (review.library_agent_id && review.graph_exec_id) {
    return getLibraryAgentHref(
      review.library_agent_id,
      review.organization_id ?? null,
      review.team_id ?? null,
      review.graph_exec_id,
      "runs",
    );
  }
  return "/library";
}
