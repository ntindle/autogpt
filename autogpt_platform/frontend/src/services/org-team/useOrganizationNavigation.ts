import { useCopilotUIStore } from "@/app/(platform)/copilot/store";
import { getQueryClient } from "@/lib/react-query/queryClient";
import { useRouter } from "next/navigation";
import { useOrgTeamStore } from "./store";

export function useOrganizationNavigation() {
  const router = useRouter();

  function openOrganization(organizationId: string) {
    const chat = useCopilotUIStore.getState();
    chat.setInitialPrompt(null);
    chat.resetArtifactPanel();
    useCopilotUIStore.setState({ copilotLlmAuth: null });
    useOrgTeamStore.getState().setActiveOrg(organizationId);
    void getQueryClient().resetQueries();
    router.replace("/home");
  }

  return { openOrganization };
}
