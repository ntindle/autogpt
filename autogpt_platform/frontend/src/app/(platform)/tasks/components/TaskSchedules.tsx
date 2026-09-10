import {
  useListTaskSchedules,
  usePauseTaskSchedule,
  useResumeTaskSchedule,
  getListTaskSchedulesQueryKey,
  getListWorkspaceTasksQueryKey,
} from "@/app/api/__generated__/endpoints/tasks/tasks";
import type { TaskScheduleInfo } from "@/app/api/__generated__/models/taskScheduleInfo";
import { okData } from "@/app/api/helpers";
import { Button } from "@/components/atoms/Button/Button";
import { useToast } from "@/components/molecules/Toast/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, Repeat } from "@phosphor-icons/react";
import Link from "next/link";

export function TaskSchedules() {
  const query = useListTaskSchedules({
    query: { select: okData, refetchInterval: 15000 },
  });
  if (query.isLoading)
    return (
      <p className="p-6 text-sm text-muted-foreground">Loading schedules…</p>
    );
  if (query.isError)
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        Schedules could not be loaded.{" "}
        <button
          type="button"
          className="underline"
          onClick={() => query.refetch()}
        >
          Try again
        </button>
      </p>
    );
  return (
    <section
      className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8"
      aria-label="Scheduled work"
    >
      <p className="mb-4 text-xs text-muted-foreground">
        Your existing workflow and chat schedules. Each Tasks occurrence
        completes independently.
      </p>
      {query.data?.length ? (
        <ul className="divide-y divide-border">
          {query.data.map((schedule) => (
            <ScheduleRow key={schedule.id} schedule={schedule} />
          ))}
        </ul>
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No scheduled work yet. Set a cadence in a task’s details.
        </p>
      )}
    </section>
  );
}

function ScheduleRow({ schedule }: { schedule: TaskScheduleInfo }) {
  const pause = usePauseTaskSchedule();
  const resume = useResumeTaskSchedule();
  const cache = useQueryClient();
  const { toast } = useToast();
  async function toggle() {
    try {
      const result = schedule.paused
        ? await resume.mutateAsync({ scheduleId: schedule.id })
        : await pause.mutateAsync({ scheduleId: schedule.id });
      if (!okData(result)) throw new Error("Could not update the schedule");
      await Promise.all([
        cache.invalidateQueries({ queryKey: getListTaskSchedulesQueryKey() }),
        cache.invalidateQueries({ queryKey: getListWorkspaceTasksQueryKey() }),
      ]);
    } catch (error) {
      toast({
        title: "Could not update schedule",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  }
  return (
    <li className="flex items-center gap-3 py-4">
      {schedule.cron ? (
        <Repeat size={20} className="shrink-0 text-violet-600" />
      ) : (
        <Clock size={20} className="shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{schedule.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {schedule.paused
            ? "Paused"
            : `Next: ${schedule.next_run_time ? new Date(schedule.next_run_time).toLocaleString() : "Waiting"}`}{" "}
          · {schedule.timezone}
          {schedule.cron ? ` · Recurring (${schedule.cron})` : " · One time"}
        </p>
      </div>
      {schedule.session_id ? (
        <Link
          className="text-xs underline"
          href={`/copilot?sessionId=${encodeURIComponent(schedule.session_id)}`}
        >
          Open chat
        </Link>
      ) : null}
      <Button
        size="small"
        variant="secondary"
        disabled={pause.isPending || resume.isPending}
        onClick={toggle}
      >
        {schedule.paused ? "Resume schedule" : "Pause schedule"}
      </Button>
    </li>
  );
}
