import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import Link from "next/link";
import type { Task } from "../helpers";
import {
  planningHold,
  statusLabel,
  taskBranch,
  taskProgress,
} from "../helpers";
import type { useTasksPage } from "../useTasksPage";
import { TaskActions } from "./TaskActions";
import { TaskAssigneePicker } from "./TaskAssigneePicker";
import { TaskEditor } from "./TaskEditor";
import { TaskQuestion } from "./TaskQuestion";
import { TaskScheduleEditor } from "./TaskScheduleEditor";
import { TaskResult } from "./TaskResult";
import { TaskResultSubmission } from "./TaskResultSubmission/TaskResultSubmission";
import { TaskIdentity } from "./TaskIdentity";

interface Props {
  task: Task | undefined;
  page: ReturnType<typeof useTasksPage>;
}

export function TaskDetails({ task, page }: Props) {
  return (
    <Sheet
      open={Boolean(task)}
      onOpenChange={(open) => {
        if (!open) page.view.update({ selected: null });
      }}
    >
      <SheetContent
        side="right"
        className="w-full overflow-y-auto px-5 sm:max-w-xl sm:px-7"
      >
        <SheetHeader className="mb-6 text-left">
          <SheetTitle>Task details</SheetTitle>
          <SheetDescription>
            {task
              ? `${statusLabel(task)}${task.activity ? ` · ${task.activity}` : ""}`
              : "Inspect your task"}
          </SheetDescription>
        </SheetHeader>
        {task ? (
          <TaskDetailsBody key={task.id} task={task} page={page} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function TaskDetailsBody({ task, page }: { task: Task; page: Props["page"] }) {
  const count = taskProgress(task, page.tasks);
  const participants = Array.from(
    new Map(
      taskBranch(task, page.tasks).flatMap((item) =>
        item.assignee
          ? [
              [
                `${item.assignee.kind}:${item.assignee.id}`,
                item.assignee,
              ] as const,
            ]
          : [],
      ),
    ).values(),
  );
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {count.done}/{count.total} required steps accepted
        </span>
        <TaskAssigneePicker
          task={task}
          assignees={page.assignees}
          held={planningHold(task, page.tasks)}
          disabled={
            page.pending ||
            task.dispatch_state === "sent" ||
            task.dispatch_state === "claimed"
          }
          onAssign={(assignee) =>
            page.act(task, { operation: "assign", assignee })
          }
        />
      </div>
      {planningHold(task, page.tasks) ? (
        <p className="rounded-lg bg-violet-100 p-3 text-sm text-violet-800">
          Plan only. Ownership can be decided while execution stays on hold.
        </p>
      ) : null}
      <TaskQuestion
        task={task}
        onCommand={(command) => page.command(task, command)}
      />
      <TaskResultSubmission
        task={task}
        pending={page.pending}
        onCommand={(command) => page.command(task, command)}
      />
      <TaskResult
        task={task}
        tasks={page.tasks}
        pending={page.pending}
        onCommand={(command) => page.act(task, command)}
      />
      <TaskEditor
        task={task}
        tasks={page.tasks}
        pending={page.pending}
        onCommand={(command) => page.act(task, command)}
      />
      <TaskScheduleEditor task={task} />
      <TaskActions
        task={task}
        pending={page.pending}
        onCommand={(command) => page.act(task, command)}
        onChat={() => page.openChat(task)}
        onBreakdown={() => page.breakdown.open(task)}
        onAdd={() => {
          page.setAddParent(task.id);
          page.view.update({
            selected: null,
            collapsed: page.view.collapsed.filter((id) => id !== task.id),
          });
          setTimeout(() => document.getElementById("task-capture")?.focus(), 0);
        }}
      />
      {participants.length > 1 ? (
        <section>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">
            Participants
          </h3>
          <div className="flex flex-wrap gap-3">
            {participants.map((person) => (
              <span
                key={`${person.kind}:${person.id}`}
                className="flex items-center gap-2 text-xs"
              >
                <TaskIdentity assignee={person} />
                {person.name}
              </span>
            ))}
          </div>
        </section>
      ) : null}
      {task.previous_session_ids?.length ? (
        <section>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">
            Previous conversations
          </h3>
          {task.previous_session_ids.map((id, index) => (
            <Link
              key={id}
              href={`/copilot?sessionId=${encodeURIComponent(id)}`}
              className="mr-3 text-sm underline"
            >
              Conversation {index + 1}
            </Link>
          ))}
        </section>
      ) : null}
      <section>
        <h3 className="mb-3 text-xs font-medium text-muted-foreground">
          Activity
        </h3>
        <ol className="space-y-3">
          {[...(task.events ?? [])].reverse().map((event) => (
            <li
              key={event.id}
              className="border-l-2 border-border pl-3 text-xs"
            >
              <span>{event.text}</span>
              <span className="mt-1 block text-muted-foreground">
                {event.actor === task.user_id ? "You" : event.actor} ·{" "}
                {event.at ? new Date(event.at).toLocaleString() : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
