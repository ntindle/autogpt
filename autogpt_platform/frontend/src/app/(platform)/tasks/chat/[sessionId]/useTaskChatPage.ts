import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getCopilotHref } from "@/services/org-team/builder";
import { useTaskSessionScope } from "../../useTaskSessionScope";

export function useTaskChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const query = useTaskSessionScope(sessionId);
  useEffect(() => {
    if (query.data) {
      router.replace(
        getCopilotHref(
          sessionId,
          query.data.organization_id,
          query.data.team_id,
        ),
      );
    }
  }, [query.data, router, sessionId]);
  return query;
}
