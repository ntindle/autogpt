import {
  useScheduleWorkspaceTask,
  getListTaskSchedulesQueryKey,
  getListWorkspaceTasksQueryKey,
} from "@/app/api/__generated__/endpoints/tasks/tasks";
import { okData } from "@/app/api/helpers";
import { Button } from "@/components/atoms/Button/Button";
import { Input } from "@/components/atoms/Input/Input";
import { useToast } from "@/components/molecules/Toast/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Task } from "../helpers";

interface Props {
  task: Task;
}

export function TaskScheduleEditor({ task }: Props) {
  const [cadence, setCadence] = useState(task.schedule?.cron ?? "once");
  const [date, setDate] = useState("");
  const [timezone, setTimezone] = useState(
    task.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const mutation = useScheduleWorkspaceTask();
  const cache = useQueryClient();
  const { toast } = useToast();
  async function save() {
    try {
      const response = await mutation.mutateAsync({
        taskId: task.id,
        data: {
          version: task.version,
          timezone:
            cadence === "once"
              ? Intl.DateTimeFormat().resolvedOptions().timeZone
              : timezone,
          cron: cadence === "once" ? null : cadence,
          run_at: cadence === "once" ? new Date(date) : null,
        },
      });
      if (!okData(response)) throw new Error("Could not save schedule");
      await Promise.all([
        cache.invalidateQueries({ queryKey: getListTaskSchedulesQueryKey() }),
        cache.invalidateQueries({ queryKey: getListWorkspaceTasksQueryKey() }),
      ]);
      toast({ title: "Schedule saved" });
    } catch (error) {
      toast({
        title: "Could not save schedule",
        description:
          error instanceof Error
            ? error.message
            : "Choose a valid future date.",
        variant: "destructive",
      });
    }
  }
  return (
    <details className="rounded-xl border border-border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        {task.schedule ? "Edit schedule" : "Schedule this work"}
      </summary>
      <div className="mt-4 space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Each occurrence is a separate task.{" "}
          {task.assignee && task.assignee.kind !== "human"
            ? "Your confirmed agent assignment carries forward."
            : "New occurrences stay on your list without starting an agent."}
        </p>
        <label className="block space-y-1 text-xs">
          Cadence
          <select
            aria-label="Schedule cadence"
            value={cadence}
            onChange={(event) => setCadence(event.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
          >
            <option value="once">Once</option>
            <option value="0 9 * * *">Every day at 9 AM</option>
            <option value="0 9 * * 1-5">Weekdays at 9 AM</option>
            <option value="0 9 * * 1">Every Monday at 9 AM</option>
          </select>
        </label>
        {cadence === "once" ? (
          <Input
            id="task-schedule-date"
            label="Date and time"
            type="datetime-local"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        ) : null}
        <Input
          id="task-schedule-timezone"
          label="Timezone"
          value={
            cadence === "once"
              ? Intl.DateTimeFormat().resolvedOptions().timeZone
              : timezone
          }
          disabled={cadence === "once"}
          onChange={(event) => setTimezone(event.target.value)}
        />
        <Button
          size="small"
          disabled={mutation.isPending || (cadence === "once" && !date)}
          onClick={save}
        >
          Save schedule
        </Button>
      </div>
    </details>
  );
}
