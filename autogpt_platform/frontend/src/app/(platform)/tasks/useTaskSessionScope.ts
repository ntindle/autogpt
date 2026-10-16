import { useGetWorkspaceTaskSessionScope } from "@/app/api/__generated__/endpoints/tasks/tasks";
import { okData } from "@/app/api/helpers";

export function useTaskSessionScope(sessionId?: string | null) {
  return useGetWorkspaceTaskSessionScope(sessionId ?? "", {
    query: { enabled: Boolean(sessionId), select: okData, retry: false },
  });
}
