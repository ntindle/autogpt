import { useListExperts } from "@/services/experts/scoped-queries";
import { useEffect, useState } from "react";
import { useOrgTeamStore } from "@/services/org-team/store";
import {
  getActiveExperts,
  getScopeName,
  readExpertScopeFromUrl,
} from "./helpers";

export function useMemoryScope() {
  // The Soul drawer's learned-notes panel links here with ?expert=<id>, so
  // the link opens on that expert. Read once — the dropdown owns it after.
  const [scopeExpertID, setScopeExpertID] = useState<string | null>(
    readExpertScopeFromUrl,
  );

  const organizationID = useOrgTeamStore((state) => state.activeOrgID);
  const isLoaded = useOrgTeamStore((state) => state.isLoaded);
  const expertsQuery = useListExperts(undefined, undefined, {
    organizationId: organizationID,
    teamId: null,
    isReady: isLoaded,
  });
  const expertsSettled = expertsQuery.data?.status === 200;
  const experts = getActiveExperts(
    expertsQuery.data?.status === 200 ? expertsQuery.data.data : undefined,
  );

  // A selected expert can disappear (fired in another tab, roster changed) —
  // fall back to Otto instead of driving queries with a dead scope id.
  useEffect(() => {
    if (!scopeExpertID || !expertsSettled) return;
    if (!experts.some((expert) => expert.id === scopeExpertID)) {
      setScopeExpertID(null);
    }
  }, [scopeExpertID, expertsSettled, experts]);

  return {
    scopeExpertID,
    selectScope: setScopeExpertID,
    experts,
    scopeName: getScopeName(scopeExpertID, experts),
  };
}
