import { useOrgTeamStore } from "@/services/org-team/store";

const queryPaths = {
  credentials: "/api/integrations/credentials",
  connections: "/api/chat/connections",
  transports: "/api/chat/transports",
};

export function useOrgConnectionScope(
  resource: keyof typeof queryPaths,
  organizationOverride?: string | null,
) {
  const activeOrgID = useOrgTeamStore((state) => state.activeOrgID);
  const organizationID =
    organizationOverride === undefined ? activeOrgID : organizationOverride;
  return {
    queryKey: [queryPaths[resource], "organization", organizationID],
    request: { headers: { "X-Org-Id": organizationID ?? "", "X-Team-Id": "" } },
  };
}
