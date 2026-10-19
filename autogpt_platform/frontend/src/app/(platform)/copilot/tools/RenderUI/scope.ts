export interface OpenUIScope {
  ownerId?: string;
  organizationId?: string | null;
  teamId?: string | null;
}

export function openUIScopeKey(scope: OpenUIScope = {}) {
  return JSON.stringify([
    scope.ownerId,
    scope.organizationId === undefined ? "unscoped" : scope.organizationId,
    scope.teamId,
  ]);
}

export function openUIRequest(scope: OpenUIScope = {}): RequestInit {
  if (scope.organizationId === undefined) return {};
  return {
    headers: {
      "X-Org-Id": scope.organizationId ?? "",
      "X-Team-Id": scope.teamId ?? "",
    },
  };
}

export function savedOpenUIScope(
  view: object,
  fallback: OpenUIScope,
): OpenUIScope {
  if (
    !("organization_id" in view) ||
    (view.organization_id !== null && typeof view.organization_id !== "string")
  )
    return fallback;
  return {
    ownerId: fallback.ownerId,
    organizationId: view.organization_id,
    teamId:
      "team_id" in view && typeof view.team_id === "string"
        ? view.team_id
        : null,
  };
}
