"use client";

import { CopilotPage } from "../copilot/CopilotPage";
import { useOrgTeamStore } from "@/services/org-team/store";

export default function HomePage() {
  const organizationId = useOrgTeamStore((state) => state.activeOrgID);
  return <CopilotPage key={organizationId ?? "personal"} />;
}
