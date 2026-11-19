import {
  getGetV1ListAllExecutionsQueryKey,
  useGetV1ListAllExecutions,
} from "@/app/api/__generated__/endpoints/graphs/graphs";

import { okData } from "@/app/api/helpers";
import {
  refetchAfterReconnect,
  useExecutionEvents,
} from "@/hooks/useExecutionEvents";
import { useLibraryAgents } from "@/hooks/useLibraryAgents/useLibraryAgents";
import type { GraphExecution } from "@/lib/autogpt-server-api/types";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createOmittedRunChecker } from "./checkOmittedRuns";
import {
  NotificationState,
  activeRunsTheListOmits,
  calculateTotalCount,
  categorizeExecutions,
  handleExecutionUpdate,
  keepActiveRunsTheListOmits,
  listHasEveryRun,
  relabelNotifications,
  removeExecutionFromAllCategories,
} from "./helpers";
import { useLiveUpdateLog } from "./useLiveUpdateLog";
import {
  getTeamScopedQueryKey,
  getTenantRequestInit,
} from "@/components/contextual/TeamPicker/helpers";
import { useOrgTeamStore } from "@/services/org-team/store";

export function useAgentActivityDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const activeOrgID = useOrgTeamStore((s) => s.activeOrgID);
  const activeTeamID = useOrgTeamStore((s) => s.activeTeamID);
  const isTenantReady = useOrgTeamStore((s) => s.isLoaded);
  const { agents, agentInfoMap } = useLibraryAgents();
  const queryClient = useQueryClient();
  const scopeKey = JSON.stringify([activeOrgID, activeTeamID]);
  const currentScope = useRef(scopeKey);
  useInsertionEffect(() => {
    currentScope.current = scopeKey;
  }, [scopeKey]);
  const liveUpdates = useLiveUpdateLog(
    getTeamScopedQueryKey(
      getGetV1ListAllExecutionsQueryKey(),
      activeOrgID,
      activeTeamID,
    ),
  );

  const [shownScope, setShownScope] = useState(scopeKey);
  const [notifications, setNotifications] = useState<NotificationState>({
    activeExecutions: [],
    recentCompletions: [],
    recentFailures: [],
    totalCount: 0,
  });

  const {
    data: executions,
    isSuccess: executionsSuccess,
    error: executionsError,
    dataUpdatedAt,
  } = useGetV1ListAllExecutions({
    query: {
      refetchOnMount: "always",
      enabled: isTenantReady,
      queryKey: getTeamScopedQueryKey(
        getGetV1ListAllExecutionsQueryKey(),
        activeOrgID,
        activeTeamID,
      ),
      select: okData,
    },
    request: getTenantRequestInit(activeOrgID, activeTeamID, isTenantReady),
  });

  const graphScopes = useMemo(
    () =>
      agents.map((agent) => ({
        graphId: agent.graph_id,
        organizationId: agent.organization_id ?? null,
        teamId: agent.team_id ?? null,
      })),
    [agents],
  );

  // Handle real-time execution updates
  const handleExecutionEvent = useCallback(
    (execution: GraphExecution) => {
      if (currentScope.current !== scopeKey) return;
      liveUpdates.recordUpdate(execution);
      setNotifications((currentState) =>
        handleExecutionUpdate(currentState, execution, agentInfoMap),
      );
    },
    [agentInfoMap, liveUpdates, scopeKey],
  );

  // Rebuild from each fetched list (keyed on dataUpdatedAt), then replay what
  // came after that list's fetch started.
  const processedListRef = useRef<number | null>(null);
  const [omittedRuns] = useState(createOmittedRunChecker);
  // Only a reconnect loses live updates, so only the list read after one
  // reads left-out runs by ID.
  const listAfterReconnectRef = useRef(false);
  if (shownScope !== scopeKey) {
    setShownScope(scopeKey);
    setNotifications({
      activeExecutions: [],
      recentCompletions: [],
      recentFailures: [],
      totalCount: 0,
    });
  }
  useInsertionEffect(() => {
    processedListRef.current = null;
    listAfterReconnectRef.current = false;
  }, [scopeKey]);
  useEffect(() => {
    if (
      !executions ||
      !executionsSuccess ||
      agentInfoMap.size === 0 ||
      processedListRef.current === dataUpdatedAt
    )
      return;
    const fromList = categorizeExecutions(executions, agentInfoMap);
    const newer = liveUpdates.updatesNewerThan(
      dataUpdatedAt,
      executions,
      listHasEveryRun(executions),
    );
    setNotifications((shown) =>
      newer.reduce(
        (state, execution) =>
          handleExecutionUpdate(state, execution, agentInfoMap),
        keepActiveRunsTheListOmits(shown, fromList, executions),
      ),
    );
    processedListRef.current = dataUpdatedAt;
    if (!listAfterReconnectRef.current) return;
    listAfterReconnectRef.current = false;
    void omittedRuns.check({
      runs: activeRunsTheListOmits(notifications, executions),
      log: liveUpdates,
      onRead: (run) => {
        if (currentScope.current !== scopeKey) return;
        setNotifications((state) =>
          handleExecutionUpdate(state, run, agentInfoMap),
        );
      },
      onGone: (runID) => {
        if (currentScope.current !== scopeKey) return;
        setNotifications((state) =>
          calculateTotalCount(removeExecutionFromAllCategories(state, runID)),
        );
      },
    });
  }, [
    executions,
    executionsSuccess,
    dataUpdatedAt,
    agentInfoMap,
    liveUpdates,
    notifications,
    omittedRuns,
    scopeKey,
  ]);

  // Subscribe to execution events for all graphs
  useExecutionEvents({
    graphScopes: graphScopes.length > 0 ? graphScopes : undefined,
    enabled: graphScopes.length > 0,
    onExecutionUpdate: handleExecutionEvent,
    onReconnect: () => {
      listAfterReconnectRef.current = true;
      refetchAfterReconnect(
        queryClient,
        getTeamScopedQueryKey(
          getGetV1ListAllExecutionsQueryKey(),
          activeOrgID,
          activeTeamID,
        ),
      );
    },
  });

  return {
    // Named at read time: the library loads page by page, and runs of
    // workflows on later pages get their names once those pages land.
    ...relabelNotifications(notifications, agentInfoMap),
    isReady: executionsSuccess,
    error: executionsError,
    isOpen,
    setIsOpen,
  };
}
