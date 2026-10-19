import { deleteV2DeleteSession } from "@/app/api/__generated__/endpoints/chat/chat";
import { getTenantRequestInit } from "@/components/contextual/TeamPicker/helpers";
import { toast } from "@/components/molecules/Toast/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryStates } from "nuqs";
import { useCopilotUIStore, type DeleteTarget } from "./store";
import {
  getSessionListQueryKey,
  SESSION_DELETE_MUTATION_KEY,
  type SessionListInfiniteData,
  removeSessionFromList,
} from "./useSessionList";

export function useSessionDeletion() {
  const queryClient = useQueryClient();
  const [{ sessionId }, setChatParams] = useQueryStates({
    sessionId: parseAsString,
    expertId: parseAsString,
  });
  const { sessionToDelete, setSessionToDelete } = useCopilotUIStore();
  const { mutate: deleteSession, isPending: isDeleting } = useMutation({
    mutationKey: SESSION_DELETE_MUTATION_KEY,
    mutationFn: (target: DeleteTarget) =>
      deleteV2DeleteSession(
        target.id,
        getTenantRequestInit(target.organizationId, target.teamId),
      ),
    onSuccess: (_data, target) => {
      queryClient.setQueriesData<SessionListInfiniteData>(
        {
          queryKey: getSessionListQueryKey(
            target.organizationId,
            target.teamId,
          ),
        },
        (data) => removeSessionFromList(data, target.id),
      );
      if (target.id === sessionId) leaveChat();
    },
    onError: (error) => {
      toast({
        title: "Failed to delete chat",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
    onSettled: (_data, _error, target) => {
      queryClient.invalidateQueries({
        queryKey: getSessionListQueryKey(target.organizationId, target.teamId),
      });
    },
  });

  function leaveChat() {
    setChatParams({ sessionId: null, expertId: null });
  }

  function requestDelete(target: DeleteTarget) {
    if (!isDeleting) setSessionToDelete(target);
  }

  function confirmDelete() {
    if (!sessionToDelete) return;
    deleteSession(sessionToDelete);
    if (sessionToDelete.id === sessionId) leaveChat();
    setSessionToDelete(null);
  }

  function cancelDelete() {
    setSessionToDelete(null);
  }

  return {
    sessionToDelete,
    isDeleting,
    requestDelete,
    confirmDelete,
    cancelDelete,
  };
}
