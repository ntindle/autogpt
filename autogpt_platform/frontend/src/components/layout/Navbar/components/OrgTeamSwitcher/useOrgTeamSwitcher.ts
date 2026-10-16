import { useOrgTeamStore } from "@/services/org-team/store";
import { useOrganizationNavigation } from "@/services/org-team/useOrganizationNavigation";

export function useOrgTeamSwitcher() {
  const { openOrganization } = useOrganizationNavigation();
  const { orgs, activeOrgID, isLoaded } = useOrgTeamStore();

  const activeOrg = orgs.find((o) => o.id === activeOrgID) || null;

  function switchOrg(orgID: string) {
    if (orgID === activeOrgID) return;
    openOrganization(orgID);
  }

  return {
    orgs,
    activeOrg,
    switchOrg,
    isLoaded,
  };
}
