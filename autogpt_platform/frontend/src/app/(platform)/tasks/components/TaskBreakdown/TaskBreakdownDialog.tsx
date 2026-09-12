import { useState } from "react";
import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import type { TaskBreakdownRequest } from "@/app/api/__generated__/models/taskBreakdownRequest";
import { Button } from "@/components/atoms/Button/Button";
import { Input } from "@/components/atoms/Input/Input";
import { Dialog } from "@/components/molecules/Dialog/Dialog";
import type { useTaskBreakdown } from "../../useTaskBreakdown";
import { planningHold, type Task } from "../../helpers";
import { BreakdownEditor } from "./BreakdownEditor";

interface Props {
  breakdown: ReturnType<typeof useTaskBreakdown>;
  tasks: Task[];
  assignees: TaskAssignee[];
}

export function TaskBreakdownDialog({ breakdown, tasks, assignees }: Props) {
  const task = breakdown.task;
  return (
    <Dialog
      title="Break down task"
      variant="compact"
      controlled={{
        isOpen: Boolean(task),
        set: (open) => {
          if (!open) breakdown.close();
        },
      }}
      className="max-w-2xl"
    >
      <Dialog.Content>
        {task ? (
          <BreakdownBody
            key={task.id}
            breakdown={breakdown}
            task={task}
            tasks={tasks}
            assignees={assignees}
          />
        ) : null}
      </Dialog.Content>
    </Dialog>
  );
}

function BreakdownBody({
  breakdown,
  task,
  tasks,
  assignees,
}: Props & { task: Task }) {
  const [detail, setDetail] = useState<TaskBreakdownRequest["detail"]>(
    task.breakdown?.detail ?? "steps",
  );
  const [guidance, setGuidance] = useState(task.breakdown?.guidance ?? "");
  const waiting = breakdown.requesting || task.breakdown?.state === "pending";
  const active =
    task.dispatch_state === "sent" ||
    task.dispatch_state === "claimed" ||
    task.status === "working";
  const parent = tasks.find((item) => item.id === task.parent_id);
  return (
    <div className="max-h-[75dvh] space-y-4 overflow-y-auto px-1">
      <div>
        <p className="text-xs text-muted-foreground">
          {[task.project, parent?.title].filter(Boolean).join(" / ") ||
            "Task workspace"}
        </p>
        <h3 className="mt-1 text-lg font-semibold">{task.title}</h3>
        {task.description ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {task.description}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          Preview the next level, edit the steps, and choose what belongs.
          Existing steps and results are kept.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Breakdown detail">
        {(
          [
            ["milestones", "Milestones"],
            ["steps", "Actionable steps"],
            ["small_steps", "Smaller steps"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="small"
            variant={detail === value ? "primary" : "secondary"}
            aria-pressed={detail === value}
            onClick={() => setDetail(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <Input
        id="breakdown-guidance"
        label="Anything the plan should account for?"
        size="small"
        value={guidance}
        maxLength={2000}
        placeholder="Constraints, scope, or what is already done…"
        onChange={(event) => setGuidance(event.target.value)}
      />
      <Button
        size="small"
        variant="secondary"
        disabled={breakdown.requesting || breakdown.accepting}
        onClick={() => breakdown.generate(task, { detail, guidance })}
      >
        {waiting ? "Restart generation" : "Generate again"}
      </Button>
      {waiting ? (
        <p role="status" className="rounded-lg bg-muted p-4 text-sm">
          Breaking this down and matching steps to your Experts…
        </p>
      ) : null}
      {task.breakdown_refresh?.state === "pending" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Updating this suggestion with new context. Your current preview is
          kept.
        </p>
      ) : null}
      {task.breakdown_refresh?.error ? (
        <p role="alert" className="text-xs text-destructive">
          The suggestion could not be updated. Generate again to retry.
        </p>
      ) : null}
      {breakdown.error || task.breakdown?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {breakdown.error || task.breakdown?.error}
        </p>
      ) : null}
      {active ? (
        <p role="status" className="text-xs text-muted-foreground">
          Work is running. Stop the attempt in task details before accepting a
          scope change.
        </p>
      ) : null}
      {task.breakdown?.state === "ready" ? (
        <BreakdownEditor
          key={task.id}
          preview={task.breakdown}
          assignees={assignees}
          disabled={breakdown.accepting || active}
          refreshState={task.breakdown_refresh?.state}
          delegated={Boolean(
            task.assignee &&
              task.assignee.kind !== "human" &&
              task.accepted !== false,
          )}
          held={planningHold(task, tasks) || Boolean(task.paused)}
          onAccept={breakdown.acceptSteps}
        />
      ) : null}
    </div>
  );
}
