import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import { Button } from "@/components/atoms/Button/Button";
import {
  Popover,
  PopoverContent,
} from "@/components/molecules/Popover/Popover";
import { Check, X } from "@phosphor-icons/react";
import type { Task } from "../../helpers";
import { TaskIdentity } from "../TaskIdentity";
import { TaskAssigneeTrigger } from "./TaskAssigneeTrigger";
import { useTaskAssigneePicker } from "./useTaskAssigneePicker";

interface Props {
  task: Task;
  assignees: TaskAssignee[];
  held: boolean;
  disabled: boolean;
  onAssign: (assignee: TaskAssignee | null) => Promise<unknown>;
  onDismiss: () => Promise<unknown>;
}

export function TaskAssigneePicker(props: Props) {
  const { task, assignees, held } = props;
  const picker = useTaskAssigneePicker(props);
  const { suggested, suggesting, identity, busy } = picker;
  return (
    <Popover open={picker.open} onOpenChange={picker.setOpen}>
      <TaskAssigneeTrigger task={task} held={held} picker={picker} />
      <PopoverContent
        aria-label={suggested ? "Review suggested owner" : "Assign task owner"}
        align="end"
        className="max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto p-4"
      >
        <p className="text-sm font-medium">
          {suggested ? "Suggested: " + identity?.name : "Assign this task"}
        </p>
        {suggested ? (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {task.suggestion?.reason}
            </p>
            <div className="flex gap-2">
              <Button
                size="small"
                className="min-h-11 min-w-0 flex-1 px-2 text-xs"
                disabled={busy}
                leftIcon={<Check size={15} aria-hidden />}
                onClick={() => picker.assign(task.suggestion ?? null)}
              >
                {task.suggestion?.kind === "human"
                  ? "Confirm responsibility"
                  : held
                    ? "Confirm · execution held"
                    : "Confirm & delegate"}
              </Button>
              <Button
                size="small"
                variant="secondary"
                className="min-h-11 min-w-0 px-2 text-xs"
                disabled={busy}
                leftIcon={<X size={15} aria-hidden />}
                onClick={() => picker.dismiss()}
              >
                Dismiss
              </Button>
            </div>
          </>
        ) : null}
        {suggesting ? (
          <p role="status" className="text-xs text-muted-foreground">
            Matching this task and its project to your Experts…
          </p>
        ) : null}
        {task.suggestion_error || picker.error ? (
          <p role="alert" className="text-xs text-destructive">
            {task.suggestion_error || picker.error}
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
              key={assignee.kind + ":" + assignee.id}
              disabled={busy}
              onClick={() => picker.assign(assignee)}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg p-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
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
            disabled={suggesting || busy}
            onClick={picker.refreshSuggestion}
          >
            {suggested ? "Suggest again" : "Suggest an owner"}
          </Button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          className="min-h-11 px-2 text-xs text-muted-foreground underline"
          onClick={() => (suggested ? picker.dismiss() : picker.assign(null))}
        >
          Leave unassigned
        </button>
      </PopoverContent>
    </Popover>
  );
}
