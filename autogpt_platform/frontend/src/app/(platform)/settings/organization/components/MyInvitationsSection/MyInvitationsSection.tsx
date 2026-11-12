"use client";

import { Badge } from "@/components/atoms/Badge/Badge";
import { Text } from "@/components/atoms/Text/Text";

import { useMyInvitationsSection } from "./useMyInvitationsSection";

export function MyInvitationsSection() {
  const { invitations } = useMyInvitationsSection();

  if (invitations.length === 0) {
    return null;
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-brand/20 bg-accent-surface p-4"
      data-testid="my-invitations-section"
    >
      <Text variant="h4" as="h2">
        You&apos;ve been invited
      </Text>
      <Text variant="body">Use your invitation link to accept or decline.</Text>
      <ul className="flex flex-col gap-2">
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex items-center gap-3"
            data-testid="my-invitation-row"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body font-medium">
                {invitation.org_name}
              </span>
              <span className="text-caption text-foreground-tertiary">
                Expires {new Date(invitation.expires_at).toLocaleDateString()}
              </span>
            </div>
            {invitation.is_admin ? <Badge variant="info">Admin</Badge> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
