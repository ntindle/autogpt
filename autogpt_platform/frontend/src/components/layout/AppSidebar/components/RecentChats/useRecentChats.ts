import {
  SESSION_GROUPS_QUERY_KEY,
  SESSION_GROUP_PAGES_QUERY_KEY,
} from "@/app/(platform)/copilot/sessionGroups";
import type { SessionListInfiniteData } from "@/app/(platform)/copilot/useSessionList";
import {
  getV2GetSession,
  patchV2UpdateSessionPinned,
  patchV2UpdateSessionTitle,
  usePatchV2UpdateSessionPinned,
  usePatchV2UpdateSessionTitle,
} from "@/app/api/__generated__/endpoints/chat/chat";
import {
  excludeSkillLearningSource,
  useExcludeSkillLearningSource,
} from "@/app/api/__generated__/endpoints/skill-learning/skill-learning";
import { fetchAndExportChat } from "@/app/(platform)/copilot/helpers/exportChatAsMarkdown";
import { SESSION_LIST_QUERY_KEY } from "@/app/(platform)/copilot/useSessionList";
import { useSessionDeletion } from "@/app/(platform)/copilot/useSessionDeletion";
import { toast } from "@/components/molecules/Toast/use-toast";
import { useStableCallback } from "@/hooks/useStableCallback";
import { ApiError } from "@/lib/autogpt-server-api/helpers";
import { CHAT_SOURCE_KIND } from "@/services/skill-learning/helpers";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { getTenantRequestInit } from "@/components/contextual/TeamPicker/helpers";

export interface RecentChatSession {
  id: string;
  title?: string | null;
  source_platform?: string | null;
  is_processing?: boolean | null;
  is_pinned?: boolean | null;
  updated_at: string;
  organization_id?: string | null;
  team_id?: string | null;
}
import { useSessionGroups } from "./useSessionGroups";

interface Args {
  /** Pinned chats get their own section and leave their groups. */
  pinnedSeparately?: boolean;
}

export function useRecentChats({ pinnedSeparately = false }: Args = {}) {
  const queryClient = useQueryClient();
  const { groups, pinnedSessions, isLoading, loadError, retryLoad } =
    useSessionGroups(pinnedSeparately);

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSessionId =
    pathname === "/home" ? searchParams.get("sessionId") : null;

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [exportingIds, setExportingIds] = useState<Set<string>>(new Set());
  const [sharingSession, setSharingSession] =
    useState<RecentChatSession | null>(null);

  function getSession(id: string) {
    const sessions = [
      ...pinnedSessions,
      ...groups.flatMap((group) => group.sessions),
    ];
    const cachedPages = queryClient.getQueriesData<SessionListInfiniteData>({
      queryKey: SESSION_GROUP_PAGES_QUERY_KEY,
    });
    const session =
      sessions.find((candidate) => candidate.id === id) ??
      cachedPages
        .flatMap(
          ([, data]) =>
            data?.pages.flatMap((page) =>
              page.status === 200 ? page.data.sessions : [],
            ) ?? [],
        )
        .find((candidate) => candidate.id === id);
    if (!session) throw new Error(`Chat session ${id} is no longer available`);
    return session;
  }

  function invalidateSessionList() {
    for (const queryKey of [
      SESSION_LIST_QUERY_KEY,
      SESSION_GROUPS_QUERY_KEY,
      SESSION_GROUP_PAGES_QUERY_KEY,
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  const {
    sessionToDelete,
    isDeleting,
    requestDelete,
    confirmDelete,
    cancelDelete,
  } = useSessionDeletion();

  const { mutate: setSessionPinned } = usePatchV2UpdateSessionPinned({
    mutation: {
      mutationFn: ({ sessionId, data }) => {
        const session = getSession(sessionId);
        return patchV2UpdateSessionPinned(
          sessionId,
          data,
          getTenantRequestInit(session.organization_id, session.team_id),
        );
      },
      onSuccess: () => {
        invalidateSessionList();
      },
      onError: (error) => {
        toast({
          title: "Failed to update chat",
          description:
            error instanceof Error ? error.message : "An error occurred",
          variant: "destructive",
        });
      },
    },
  });

  const { mutate: renameSession } = usePatchV2UpdateSessionTitle({
    mutation: {
      mutationFn: ({ sessionId, data }) => {
        const session = getSession(sessionId);
        return patchV2UpdateSessionTitle(
          sessionId,
          data,
          getTenantRequestInit(session.organization_id, session.team_id),
        );
      },
      onSuccess: () => {
        invalidateSessionList();
        setEditingSessionId(null);
      },
      onError: (error) => {
        toast({
          title: "Failed to rename chat",
          description:
            error instanceof Error ? error.message : "An error occurred",
          variant: "destructive",
        });
        setEditingSessionId(null);
      },
    },
  });

  const { mutate: excludeSource } = useExcludeSkillLearningSource({
    mutation: {
      mutationFn: ({ sourceKind, sourceRef }) => {
        const session = getSession(sourceRef);
        return excludeSkillLearningSource(
          sourceKind,
          sourceRef,
          getTenantRequestInit(session.organization_id, session.team_id),
        );
      },
      onSuccess: () => {
        toast({
          title: "Excluded from learning",
          description:
            "This chat will not be used for future skill learning. Skills " +
            "that depended on it were restored or paused.",
        });
      },
      onError: (error) => {
        toast({
          title: "Could not exclude this chat",
          description:
            error instanceof ApiError
              ? error.message
              : "Nothing has been recorded for this chat yet.",
          variant: "destructive",
        });
      },
    },
  });

  // Every handler handed to the rows keeps one identity across renders, so the
  // memoised `RecentChatItem`s only re-render when their own props change.
  const excludeFromLearning = useStableCallback((id: string) => {
    excludeSource({ sourceKind: CHAT_SOURCE_KIND, sourceRef: id });
  });

  const togglePin = useStableCallback((id: string, isPinned: boolean) => {
    setSessionPinned({ sessionId: id, data: { is_pinned: !isPinned } });
  });

  const startRename = useStableCallback(
    (id: string, title: string | null | undefined) => {
      setEditingSessionId(id);
      setEditingTitle(title || "");
    },
  );

  const submitRename = useStableCallback((id: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      renameSession({ sessionId: id, data: { title: trimmed } });
    } else {
      setEditingSessionId(null);
    }
  });

  const cancelRename = useStableCallback(() => setEditingSessionId(null));

  const stableRequestDelete = useStableCallback((session: RecentChatSession) =>
    requestDelete({
      id: session.id,
      title: session.title,
      organizationId: session.organization_id ?? null,
      teamId: session.team_id ?? null,
    }),
  );

  const exportChat = useStableCallback(handleExport);

  async function handleExport(id: string, title: string | null | undefined) {
    if (exportingIds.has(id)) return;
    setExportingIds((prev) => new Set(prev).add(id));
    try {
      const session = getSession(id);
      await fetchAndExportChat(
        id,
        title,
        getV2GetSession,
        getTenantRequestInit(session.organization_id, session.team_id),
      );
      toast({ title: "Chat exported" });
    } catch (error) {
      toast({
        title: "Export failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not export this chat. Please try again.",
        variant: "destructive",
      });
    } finally {
      setExportingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return {
    groups,
    pinnedSessions,
    isLoading,
    loadError,
    retryLoad,
    activeSessionId,
    togglePin,
    editingSessionId,
    editingTitle,
    setEditingTitle,
    startRename,
    submitRename,
    cancelRename,
    exportingIds,
    exportChat,
    sharingSession,
    setSharingSession,
    excludeFromLearning,
    sessionToDelete,
    isDeleting,
    requestDelete: stableRequestDelete,
    confirmDelete,
    cancelDelete,
  };
}
