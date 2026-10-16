import { useOrgTeamStore } from "@/services/org-team/store";
import { Flag, useGetFlag } from "@/services/feature-flags/use-get-flag";
import { getTenantRequestInit } from "./helpers";

export function useCreateTeamSelection(_surfaceKey: string) {
  const enabled = useGetFlag(Flag.SHOW_ORG_SETTINGS);
  const { activeOrgID, teams, isLoaded } = useOrgTeamStore();
  const teamId = enabled
    ? null
    : (teams.find((team) => team.orgId === activeOrgID && team.isDefault)?.id ??
      null);
  const isReady = isLoaded && activeOrgID !== null;

  function setTeamId(_teamId: string | null) {}

  return {
    teamId,
    setTeamId,
    hasTeams: false,
    isReady,
    teamRequestInit: getTenantRequestInit(activeOrgID, teamId, isReady),
  };
}
