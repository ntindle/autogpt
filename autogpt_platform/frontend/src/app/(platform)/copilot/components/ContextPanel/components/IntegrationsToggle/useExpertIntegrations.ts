import { useListExpertCredentials } from "@/services/experts/scoped-queries";
import { okData } from "@/app/api/helpers";

export function useExpertIntegrations(expertId: string | null) {
  const query = useListExpertCredentials(expertId ?? "", {
    query: {
      enabled: Boolean(expertId),
      select: (response) => okData(response) ?? [],
    },
  });

  return { integrations: query.data ?? [] };
}
