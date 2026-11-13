export interface ResourceScope {
  organization_id?: string | null;
  team_id?: string | null;
}

export function resourceHeaders(scope: ResourceScope): Record<string, string> {
  return {
    ...(scope.organization_id ? { "X-Org-Id": scope.organization_id } : {}),
    ...(scope.team_id ? { "X-Team-Id": scope.team_id } : {}),
  };
}

export function resourceKey(scope: ResourceScope) {
  return [scope.organization_id ?? null, scope.team_id ?? null] as const;
}
