import { useGetWorkspaceFileViewState } from "@/app/api/__generated__/endpoints/workspace/workspace";
import {
  fileDraftQueryKey,
  type DraftRemote,
} from "../../tools/RenderUI/draftTargets";
import { readViewMeta } from "../../tools/RenderUI/helpers";
import { isNotFound } from "./helpers";
import { useOpenUIScope } from "../../tools/RenderUI/OpenUIScopeContext";
import { openUIRequest } from "../../tools/RenderUI/scope";

export function useOpenUIFileView(fileId: string) {
  const scope = useOpenUIScope();
  const query = useGetWorkspaceFileViewState(fileId, {
    query: {
      retry: false,
      refetchOnWindowFocus: false,
      queryKey: fileDraftQueryKey(fileId, scope),
    },
    request: openUIRequest(scope),
  });
  const view = query.data?.status === 200 ? query.data.data : null;
  const remote: DraftRemote = {
    data: view
      ? {
          source: view.source,
          state: view.state,
          revision: view.revision,
          writable: true,
        }
      : null,
    settled: !query.isFetching,
    version: Math.max(query.dataUpdatedAt, query.errorUpdatedAt),
    refetch: query.refetch,
  };
  return {
    view,
    meta: view ? readViewMeta(view.source) : null,
    remote,
    isLoading: query.isPending,
    isMissing: isNotFound(query.error),
    isError: query.isError,
    retry: query.refetch,
  };
}
