"use client";

import { createContext, useContext } from "react";

interface TaskScope {
  organizationId: string | null;
  teamId: string | null;
  ready: boolean;
}

export const TaskScopeContext = createContext<TaskScope>({
  organizationId: null,
  teamId: null,
  ready: true,
});

export function useTaskScope() {
  const scope = useContext(TaskScopeContext);
  const request: RequestInit = {
    headers: {
      "X-Org-Id": scope.ready
        ? (scope.organizationId ?? "")
        : "__org_context_loading__",
      "X-Team-Id": scope.teamId ?? "",
    },
  };

  function queryKey(base: readonly unknown[]) {
    return [...base, { organizationId: scope.organizationId }];
  }

  return { ...scope, request, queryKey };
}
