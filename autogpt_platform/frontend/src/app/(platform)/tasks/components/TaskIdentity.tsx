import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/atoms/Avatar/Avatar";
import { AutopilotAvatar } from "@/components/molecules/AutopilotAvatar/AutopilotAvatar";
import { ExpertAvatar } from "@/components/molecules/ExpertAvatar/ExpertAvatar";
import { Icon } from "@/components/atoms/Icon/Icon";
import { UserIcon } from "@hugeicons/core-free-icons";

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
        <ExpertAvatar
          name={assignee.name}
          avatarUrl={assignee.avatar_url ?? null}
          color={assignee.color ?? null}
          size={26}
        />
      ) : assignee?.kind === "auto" ? (
        <AutopilotAvatar size={26} />
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
              <Icon icon={UserIcon} size={16} />
            )}
          </AvatarFallback>
        </Avatar>
      )}
    </span>
  );
}
