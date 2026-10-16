import {
  getTeamScopedQueryKey,
  getTenantRequestInit,
} from "@/components/contextual/TeamPicker/helpers";
import { useOrgTeamStore } from "@/services/org-team/store";
import {
  ORG_HEADER_NAME,
  TEAM_HEADER_NAME,
} from "@/services/org-team/header-names";
import type { UseQueryOptions } from "@tanstack/react-query";

export interface PrivateResourceScope {
  organizationId: string | null;
  teamId?: string | null;
  isReady?: boolean;
}

export function usePrivateResourceScope(scope?: PrivateResourceScope) {
  const organizationId = useOrgTeamStore((state) => state.activeOrgID);
  const teamId = useOrgTeamStore((state) => state.activeTeamID);
  const isReady = useOrgTeamStore((state) => state.isLoaded);
  return scope
    ? { ...scope, isReady: scope.isReady ?? true }
    : { organizationId, teamId, isReady };
}

export function pinnedResourceRequest(
  scope: PrivateResourceScope,
  request?: RequestInit,
) {
  const headers = new Headers(request?.headers);
  headers.delete(ORG_HEADER_NAME);
  headers.delete(TEAM_HEADER_NAME);
  return {
    ...request,
    headers: {
      ...Object.fromEntries(headers),
      ...getTenantRequestInit(scope.organizationId, scope.teamId, scope.isReady)
        .headers,
    },
  };
}

export function scopedResourceQuery<TQuery, TError, TData>(
  key: readonly unknown[],
  scope: PrivateResourceScope,
  options?: Partial<UseQueryOptions<TQuery, TError, TData>>,
) {
  return {
    ...options,
    queryKey: getTeamScopedQueryKey(
      options?.queryKey ?? key,
      scope.organizationId,
      scope.teamId,
    ),
    enabled: scope.isReady !== false && (options?.enabled ?? true),
    placeholderData: undefined,
  };
}
