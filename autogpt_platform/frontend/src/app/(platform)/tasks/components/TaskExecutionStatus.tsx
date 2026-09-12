import { Pause, WarningCircle } from "@phosphor-icons/react";
import { planningHoldSource, unmetPrerequisites, type Task } from "../helpers";

interface Props {
  task: Task;
  tasks: Task[];
  onChat: () => void;
}

export function TaskExecutionStatus({ task, tasks, onChat }: Props) {
  if (task.status === "done" || task.status === "canceled") return null;
  const hold = planningHoldSource(task, tasks);
  const prerequisites = unmetPrerequisites(task, tasks);
  return (
    <div className="space-y-3 text-sm">
      {task.accepted === false ? (
        <p className="rounded-lg border border-dashed border-violet-300 bg-violet-50 p-3">
          Proposed work. Accept this task to add it to the agreed scope.
        </p>
      ) : hold ? (
        <p className="rounded-lg bg-muted p-3">
          <Pause size={15} className="mr-1 inline" />
          Execution on hold{hold.id !== task.id ? ` by ${hold.title}` : ""}.
          Start enables this branch when its prerequisites are complete. Other
          branches keep their holds.
        </p>
      ) : null}
      {prerequisites.length > 0 ? (
        <p className="rounded-lg bg-muted p-3">
          Waiting for: {prerequisites.map((item) => item.title).join(", ")}.
          Assigned work starts automatically once these results are accepted and
          execution is enabled.
        </p>
      ) : null}
      {task.status === "blocked" && task.dispatch_state === "finished" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <p>
            <WarningCircle size={15} className="mr-1 inline" />
            The last attempt stopped before producing an accepted result. The
            conversation has the reason and any setup still needed.
          </p>
          <button
            type="button"
            onClick={onChat}
            className="mt-2 rounded underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open attempt details
          </button>
        </div>
      ) : null}
    </div>
  );
}
