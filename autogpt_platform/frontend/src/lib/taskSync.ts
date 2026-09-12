import { getGetHomeDashboardQueryKey } from "@/app/api/__generated__/endpoints/home/home";
import { getListWorkspaceTasksQueryKey } from "@/app/api/__generated__/endpoints/tasks/tasks";
import type { QueryClient } from "@tanstack/react-query";

export async function invalidateTaskSurfaces(cache: QueryClient) {
  await Promise.all([
    cache.invalidateQueries({ queryKey: getListWorkspaceTasksQueryKey() }),
    cache.invalidateQueries({ queryKey: getGetHomeDashboardQueryKey() }),
  ]);
}
