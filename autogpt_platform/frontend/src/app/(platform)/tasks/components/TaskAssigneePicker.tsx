import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import { Button } from "@/components/atoms/Button/Button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/molecules/Popover/Popover";
import { cn } from "@/lib/utils";
import {
  useSuggestWorkspaceTaskOwner,
  getListWorkspaceTasksQueryKey,
} from "@/app/api/__generated__/endpoints/tasks/tasks";
import { useQueryClient } from "@tanstack/react-query";
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
  const [assigning, setAssigning] = useState(false);
  const suggest = useSuggestWorkspaceTaskOwner();
  const cache = useQueryClient();
  const identity = task.assignee ?? task.suggestion;
  const suggesting =
    !task.assignee &&
    (task.suggestion_state === "pending" || suggest.isPending);
  async function refreshSuggestion() {
    await suggest.mutateAsync({ taskId: task.id });
    await cache.invalidateQueries({
      queryKey: getListWorkspaceTasksQueryKey(),
    });
  }
  const suggested = !task.assignee && Boolean(task.suggestion);
  async function assign(assignee: TaskAssignee | null) {
    setAssigning(true);
    try {
      const updated = await onAssign(assignee);
      if (updated) setOpen(false);
    } finally {
      setAssigning(false);
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || assigning}
          aria-label={`${suggested ? "Suggested" : "Assigned to"}: ${identity?.name ?? "Unassigned"}. Change assignee for ${task.title}`}
          className={cn(
            "flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            suggested && "text-violet-700",
          )}
        >
          <TaskIdentity assignee={identity} suggested={suggested} />
          <span className="max-w-24 truncate text-xs sm:max-w-36">
            {suggesting ? "Finding owner…" : (identity?.name ?? "Choose owner")}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-4">
        <p className="text-sm font-medium">
          {suggested ? `Suggested: ${identity?.name}` : "Assign this task"}
        </p>
        {suggested ? (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {task.suggestion?.reason}
            </p>
            <Button
              size="small"
              className="w-full"
              disabled={assigning}
              onClick={() => assign(task.suggestion ?? null)}
            >
              {task.suggestion?.kind === "human"
                ? "Confirm responsibility"
                : held
                  ? "Confirm · execution held"
                  : "Confirm & delegate"}
            </Button>
          </>
        ) : null}
        {suggesting ? (
          <p role="status" className="text-xs text-muted-foreground">
            Matching this task and its project to your Experts…
          </p>
        ) : null}
        {task.suggestion_error || suggest.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {task.suggestion_error ||
              "Could not request a suggestion. Please try again."}
          </p>
        ) : null}
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {[
            ...(task.suggestion_alternatives ?? []),
            ...assignees.filter(
              (a) =>
                !(task.suggestion_alternatives ?? []).some(
                  (candidate) => candidate.id === a.id,
                ),
            ),
          ].map((assignee) => (
            <button
              type="button"
              key={`${assignee.kind}:${assignee.id}`}
              disabled={assigning}
              onClick={() => assign(assignee)}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <TaskIdentity assignee={assignee} />
              <span>
                {assignee.name}
                <span className="block text-xs text-muted-foreground">
                  {(assignee.id !== task.suggestion?.id
                    ? assignee.reason
                    : null) ||
                    assignee.role ||
                    (assignee.kind === "human"
                      ? "Assign responsibility"
                      : held
                        ? "Assign · execution held"
                        : "Assign & delegate")}
                </span>
              </span>
            </button>
          ))}
        </div>
        {!task.assignee ? (
          <Button
            size="small"
            variant="secondary"
            disabled={suggesting}
            onClick={() => {
              void refreshSuggestion().catch(() => undefined);
            }}
          >
            {suggested ? "Suggest again" : "Suggest an owner"}
          </Button>
        ) : null}
        <button
          type="button"
          className="ml-2 text-xs text-muted-foreground underline"
          onClick={() => assign(null)}
        >
          Leave unassigned
        </button>
      </PopoverContent>
    </Popover>
  );
}
