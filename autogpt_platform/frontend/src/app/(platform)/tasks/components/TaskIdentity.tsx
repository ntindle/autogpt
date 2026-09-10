import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/atoms/Avatar/Avatar";
import { BotAvatar } from "@/components/molecules/BotAvatar/BotAvatar";
import { expertAvatarConfig } from "@/components/molecules/BotAvatar/helpers";
import { cn } from "@/lib/utils";
import { Sparkle, User } from "@phosphor-icons/react";

interface Props {
  assignee?: TaskAssignee | null;
  suggested?: boolean;
}

export function TaskIdentity({ assignee, suggested = false }: Props) {
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
        suggested && "border border-dashed border-violet-500 p-0.5",
      )}
      title={assignee?.name ?? "Unassigned"}
    >
      {assignee?.kind === "expert" ? (
        <BotAvatar
          config={expertAvatarConfig({
            name: assignee.name,
            avatarUrl: assignee.avatar_url,
            color: null,
          })}
          size={26}
          showBadge={false}
          title={assignee.name}
        />
      ) : assignee?.kind === "auto" ? (
        <span className="flex size-7 items-center justify-center rounded-full bg-violet-100 text-violet-700">
          <Sparkle size={17} weight="fill" />
        </span>
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
