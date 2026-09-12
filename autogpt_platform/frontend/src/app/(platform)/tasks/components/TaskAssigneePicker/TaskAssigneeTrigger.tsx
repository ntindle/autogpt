import { PopoverTrigger } from "@/components/molecules/Popover/Popover";
import { Check, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { Task } from "../../helpers";
import { TaskIdentity } from "../TaskIdentity";
import type { useTaskAssigneePicker } from "./useTaskAssigneePicker";

interface Props {
  task: Task;
  held: boolean;
  picker: ReturnType<typeof useTaskAssigneePicker>;
}

export function TaskAssigneeTrigger({ task, held, picker }: Props) {
  const { identity, suggested, suggesting, busy } = picker;
  const name = identity?.name ?? "Unassigned";
  const acceptance =
    identity?.kind === "human"
      ? "Confirm responsibility"
      : held
        ? "Confirm owner; execution stays on hold"
        : "Confirm owner and delegate";
  return (
    <div className="group/owner flex items-center gap-1" aria-busy={busy}>
      <PopoverTrigger asChild>
        <button
          ref={picker.triggerRef}
          type="button"
          disabled={busy}
          aria-label={
            (suggested ? "Suggested" : "Assigned to") +
            ": " +
            name +
            ". Change assignee for " +
            task.title
          }
          className={cn(
            "flex min-h-11 items-center gap-1 rounded-full border border-transparent pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:min-h-9",
            suggested &&
              "border-dashed border-violet-500 bg-violet-50/40 pl-1 pr-2.5 text-violet-700",
          )}
        >
          <TaskIdentity assignee={identity} />
          <span className="max-w-24 truncate text-xs sm:max-w-36">
            {suggesting ? "Finding owner…" : (identity?.name ?? "Choose owner")}
          </span>
        </button>
      </PopoverTrigger>
      {suggested ? (
        <div
          role="group"
          aria-label="Suggested owner actions"
          className="pointer-events-none flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/owner:pointer-events-auto group-focus-within/owner:opacity-100 group-hover/owner:pointer-events-auto group-hover/owner:opacity-100 motion-reduce:transition-none [@media(hover:none)]:hidden [@media(pointer:coarse)]:hidden"
        >
          <button
            type="button"
            disabled={busy}
            aria-label={"Accept " + name + " for " + task.title}
            title={acceptance}
            onClick={(event) =>
              picker.assign(task.suggestion ?? null, event.detail === 0)
            }
            className="flex size-7 items-center justify-center rounded-full text-violet-700 hover:bg-violet-100 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <Check size={15} weight="bold" aria-hidden />
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label={"Dismiss suggested owner for " + task.title}
            title="Dismiss suggestion"
            onClick={(event) => picker.dismiss(event.detail === 0)}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <X size={15} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
