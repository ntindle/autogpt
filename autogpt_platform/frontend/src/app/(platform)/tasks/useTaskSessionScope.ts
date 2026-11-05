import { useGetWorkspaceTaskSessionScope } from "@/app/api/__generated__/endpoints/tasks/tasks";
import { okData } from "@/app/api/helpers";

export function useTaskSessionScope(sessionId?: string | null) {
  const query = useGetWorkspaceTaskSessionScope(sessionId ?? "", {
    query: {
      enabled: Boolean(sessionId),
      select: okData,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  });
  return {
    ...query,
    data:
      query.isFetchedAfterMount && !query.isFetching && !query.isError
        ? query.data
        : undefined,
  };
}
