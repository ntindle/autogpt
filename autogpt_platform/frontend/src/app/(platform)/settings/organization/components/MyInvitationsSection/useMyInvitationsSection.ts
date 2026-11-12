"use client";

import { useGetV2ListPendingInvitationsForCurrentUser } from "@/app/api/__generated__/endpoints/invitations/invitations";
import type { UserInvitationResponse } from "@/app/api/__generated__/models/userInvitationResponse";

export function useMyInvitationsSection() {
  const invitationsQuery = useGetV2ListPendingInvitationsForCurrentUser({
    query: {
      select: (res) => res.data as UserInvitationResponse[],
    },
  });

  return { invitations: invitationsQuery.data ?? [] };
}
