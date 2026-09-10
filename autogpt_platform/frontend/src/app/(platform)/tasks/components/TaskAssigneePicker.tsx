import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import { Button } from "@/components/atoms/Button/Button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/molecules/Popover/Popover";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { Task } from "../helpers";
import { TaskIdentity } from "./TaskIdentity";

interface Props {
  task: Task;
  assignees: TaskAssignee[];
  held: boolean;
  disabled: boolean;
  onAssign: (assignee: TaskAssignee | null) => Promise<unknown>;
}

export function TaskAssigneePicker({
  task,
  assignees,
  held,
  disabled,
  onAssign,
}: Props) {
  const [open, setOpen] = useState(false);
  const identity = task.assignee ?? task.suggestion;
  const suggested = !task.assignee && Boolean(task.suggestion);
  async function assign(assignee: TaskAssignee | null) {
    await onAssign(assignee);
    setOpen(false);
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${suggested ? "Suggested" : "Assigned to"}: ${identity?.name ?? "Unassigned"}. Change assignee for ${task.title}`}
          className={cn(
            "flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            suggested && "text-violet-700",
          )}
        >
          <TaskIdentity assignee={identity} suggested={suggested} />
          {suggested ? (
            <span className="hidden text-xs lg:inline">Suggested</span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-4">
        <p className="text-sm font-medium">
          {suggested ? "Suggested ownership" : "Assign this task"}
        </p>
        {suggested ? (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {task.suggestion?.reason}
            </p>
            <Button
              size="small"
              className="w-full"
              onClick={() => assign(task.suggestion ?? null)}
            >
              {held ? "Confirm · plan only" : "Confirm & delegate"}
            </Button>
          </>
        ) : null}
        <div className="space-y-1">
          {assignees.map((assignee) => (
            <button
              type="button"
              key={`${assignee.kind}:${assignee.id}`}
              onClick={() => assign(assignee)}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <TaskIdentity assignee={assignee} />
              <span>
                {assignee.name}
                <span className="block text-xs text-muted-foreground">
                  {assignee.kind === "human"
                    ? "Assign responsibility"
                    : held
                      ? "Assign · plan only"
                      : "Assign & delegate"}
                </span>
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => assign(null)}
        >
          Leave unassigned
        </button>
      </PopoverContent>
    </Popover>
  );
}
