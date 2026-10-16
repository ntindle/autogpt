import { useCopilotTenantScope } from "../../../../CopilotTenantScopeContext";
import { useOrgConnectionScope } from "@/services/credentials/useOrgConnectionScope";
import { useGetV2ListChatTransports } from "@/app/api/__generated__/endpoints/chat/chat";
import { getAvailableLLMTransports } from "@/app/(platform)/copilot/helpers/copilotLlmAuth";

export function useNoAIConnectionNotice(enabled: boolean) {
  const tenantScope = useCopilotTenantScope();
  const transportsScope = useOrgConnectionScope(
    "transports",
    tenantScope.organizationId,
  );
  const transportsQuery = useGetV2ListChatTransports({
    request: transportsScope.request,
    query: { queryKey: transportsScope.queryKey, enabled },
  });
  const transports =
    transportsQuery.data?.status === 200
      ? transportsQuery.data.data.transports
      : undefined;

  return {
    hasNoConnection:
      enabled &&
      transports !== undefined &&
      getAvailableLLMTransports(transports).length === 0,
  };
}
