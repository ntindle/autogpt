import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/atoms/Avatar/Avatar";
import { BotAvatar } from "@/components/molecules/BotAvatar/BotAvatar";
import {
  AUTOPILOT_AVATAR,
  expertAvatarConfig,
} from "@/components/molecules/BotAvatar/helpers";
import { User } from "@phosphor-icons/react";

interface Props {
  assignee?: TaskAssignee | null;
}

export function TaskIdentity({ assignee }: Props) {
  return (
    <span
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full"
      title={assignee?.name ?? "Unassigned"}
    >
      {assignee?.kind === "expert" ? (
        <BotAvatar
          config={expertAvatarConfig({
            name: assignee.name,
            avatarUrl: assignee.avatar_url,
            color: assignee.color ?? null,
          })}
          size={26}
          showBadge={false}
          title={assignee.name}
        />
      ) : assignee?.kind === "auto" ? (
        <BotAvatar
          config={AUTOPILOT_AVATAR}
          size={26}
          showBadge={false}
          title={assignee.name}
        />
      ) : (
        <Avatar className="size-7 bg-zinc-100">
          <AvatarImage
            src={assignee?.avatar_url ?? undefined}
            alt={assignee?.name ?? "Unassigned"}
          />
          <AvatarFallback>
            {assignee ? (
              assignee.name.slice(0, 2).toUpperCase()
            ) : (
              <User size={16} />
            )}
          </AvatarFallback>
        </Avatar>
      )}
    </span>
  );
}
