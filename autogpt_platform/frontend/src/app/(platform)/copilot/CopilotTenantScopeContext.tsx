"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useOrgTeamStore } from "@/services/org-team/store";

interface CopilotTenantScope {
  organizationId: string | null;
  teamId: string | null;
}

const CopilotTenantScopeContext = createContext<CopilotTenantScope | undefined>(
  undefined,
);

interface Props extends CopilotTenantScope {
  children: ReactNode;
}

export function CopilotTenantScopeProvider({
  organizationId,
  teamId,
  children,
}: Props) {
  return (
    <CopilotTenantScopeContext.Provider value={{ organizationId, teamId }}>
      {children}
    </CopilotTenantScopeContext.Provider>
  );
}

export function useCopilotTenantScope() {
  const scope = useContext(CopilotTenantScopeContext);
  const organizationId = useOrgTeamStore((state) => state.activeOrgID);
  const teamId = useOrgTeamStore((state) => state.activeTeamID);
  return scope ?? { organizationId, teamId };
}
