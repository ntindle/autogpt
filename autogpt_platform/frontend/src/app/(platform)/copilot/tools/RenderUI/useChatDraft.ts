import { useGetV2GetUiDraft } from "@/app/api/__generated__/endpoints/chat/chat";
import { chatDraftQueryKey, type DraftRemote } from "./draftTargets";
import { useOpenUIScope } from "./OpenUIScopeContext";
import { openUIRequest } from "./scope";

interface Args {
  ownerId: string | undefined;
  sessionId: string;
  viewId: string;
  toolCallId: string;
  enabled: boolean;
}

export function useChatDraft(args: Args) {
  const { sessionId, viewId, toolCallId, enabled } = args;
  const scope = useOpenUIScope();
  const query = useGetV2GetUiDraft(
    sessionId,
    viewId,
    { tool_call_id: toolCallId },
    {
      query: {
        enabled,
        retry: false,
        refetchOnWindowFocus: false,
        queryKey: chatDraftQueryKey({ ...args, scope }),
      },
      request: openUIRequest(scope),
    },
  );
  const data = query.data?.status === 200 ? query.data.data : null;
  const remote: DraftRemote = {
    data: data
      ? {
          source: data.source,
          state: data.state,
          revision: data.revision,
          writable: data.writable,
        }
      : null,
    settled: !query.isPending && !query.isFetching,
    version: Math.max(query.dataUpdatedAt, query.errorUpdatedAt),
    refetch: query.refetch,
  };
  return { fileId: data?.file_id ?? null, remote };
}
