import {
  getTeamScopedQueryKey,
  getTenantRequestInit,
} from "@/components/contextual/TeamPicker/helpers";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getV1GetSpecificGraph } from "@/app/api/__generated__/endpoints/graphs/graphs";
import { getV2GetLibraryAgentByGraphId } from "@/app/api/__generated__/endpoints/library/library";
import {
  getGetV2GetMyLiveSubmissionQueryKey,
  getGetV2GetMyLiveSubmissionQueryOptions,
} from "@/app/api/__generated__/endpoints/store/store";
import type { LiveStoreSubmission } from "@/app/api/__generated__/models/liveStoreSubmission";
import { okData } from "@/app/api/helpers";
import { ApiError } from "@/lib/autogpt-server-api/helpers";
import { type AgentFormSource, toAgentFormSource } from "./helpers";

type ListingScope = { organizationId: string | null; teamId: string | null };

type CheckStatus = "idle" | "checking" | "failed";

/**
 * Asks for a workflow's live Marketplace listing before the dialog builds its
 * form, so a slow or failed answer never opens the new-listing form for a
 * listed workflow. A check the dialog has moved on from (closed, or started
 * another) is dropped when it lands.
 */
export function useLiveListingCheck() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CheckStatus>("idle");
  const latestCheck = useRef(0);

  async function run<T>(
    load: () => Promise<T>,
    onChecked: (result: T) => void,
  ) {
    const check = ++latestCheck.current;
    setStatus("checking");
    try {
      const result = await load();
      if (check !== latestCheck.current) return;
      setStatus("idle");
      onChecked(result);
    } catch {
      if (check === latestCheck.current) setStatus("failed");
    }
  }

  async function fetchLiveSubmission(graphId: string, scope: ListingScope) {
    const response = await queryClient.fetchQuery(
      getGetV2GetMyLiveSubmissionQueryOptions(graphId, {
        query: {
          staleTime: 0,
          queryKey: getTeamScopedQueryKey(
            getGetV2GetMyLiveSubmissionQueryKey(graphId),
            scope.organizationId,
            scope.teamId,
          ),
        },
        request: getTenantRequestInit(scope.organizationId, scope.teamId, true),
      }),
    );
    if (response.status !== 200) {
      throw new Error(`Live listing lookup answered ${response.status}`);
    }
    return response.data;
  }

  // Read directly, not from the creator's list of workflows: that list leaves
  // out a version that's already listed, and comes a page at a time. Fetched
  // outside the query cache, so the builder's copy of the graph isn't touched.
  async function fetchAgent(
    graphId: string,
    version: number | undefined,
    scope: ListingScope,
  ) {
    const [graph, libraryAgent] = await Promise.all([
      getV1GetSpecificGraph(
        graphId,
        version === undefined ? undefined : { version },
        getTenantRequestInit(scope.organizationId, scope.teamId, true),
      ),
      fetchLibraryAgent(graphId, scope),
    ]);
    const workflow = okData(graph);
    if (!workflow) throw new Error(`Workflow lookup answered ${graph.status}`);
    return toAgentFormSource(workflow, libraryAgent);
  }

  // An archived or removed Library entry answers 404. The workflow can still
  // be published; it just has no image to start from.
  async function fetchLibraryAgent(graphId: string, scope: ListingScope) {
    try {
      return (
        okData(
          await getV2GetLibraryAgentByGraphId(
            graphId,
            undefined,
            getTenantRequestInit(scope.organizationId, scope.teamId, true),
          ),
        ) ?? null
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  function checkPickedAgent(
    graphId: string,
    onChecked: (live: LiveStoreSubmission | null) => void,
    scope: ListingScope,
  ) {
    void run(() => fetchLiveSubmission(graphId, scope), onChecked);
  }

  function checkPreSelectedAgent(
    graphId: string,
    version: number | undefined,
    onChecked: (
      live: LiveStoreSubmission | null,
      agent: AgentFormSource,
    ) => void,
    scope: ListingScope,
  ) {
    void run(
      () =>
        Promise.all([
          fetchLiveSubmission(graphId, scope),
          fetchAgent(graphId, version, scope),
        ]),
      ([live, agent]) => onChecked(live, agent),
    );
  }

  function cancel() {
    latestCheck.current += 1;
    setStatus("idle");
  }

  return {
    checkPickedAgent,
    checkPreSelectedAgent,
    cancel,
    isChecking: status === "checking",
    hasFailed: status === "failed",
  };
}
