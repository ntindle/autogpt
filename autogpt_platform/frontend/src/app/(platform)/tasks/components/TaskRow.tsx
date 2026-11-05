import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import type { TaskCommand } from "@/app/api/__generated__/models/taskCommand";
import { cn } from "@/lib/utils";
import {
  TreeStructure,
  CaretDown,
  CaretRight,
  ChatCircle,
  Clock,
  DotsThree,
  Pause,
  Play,
} from "@phosphor-icons/react";
import {
  planningHold,
  canStartTask,
  statusLabel,
  reviewWaitingReason,
  taskBranch,
  taskProgress,
  type Task,
} from "../helpers";
import { TaskAssigneePicker } from "./TaskAssigneePicker/TaskAssigneePicker";
import { TaskIdentity } from "./TaskIdentity";
import { TaskAttemptInfo } from "./TaskAttemptInfo";

interface Props {
  task: Task;
  tasks: Task[];
  assignees: TaskAssignee[];
  collapsed: boolean;
  pending: boolean;
  onToggle: () => void;
  onDetails: () => void;
  onChat: () => void;
  onBreakdown: () => void;
  onCommand: (command: Omit<TaskCommand, "version">) => Promise<unknown>;
}

export function TaskRow({
  task,
  tasks,
  assignees,
  collapsed,
  pending,
  onToggle,
  onDetails,
  onChat,
  onBreakdown,
  onCommand,
}: Props) {
  const parent = tasks.some((item) => item.parent_id === task.id);
  const count = taskProgress(task, tasks);
  const human = !task.assignee || task.assignee.kind === "human";
  const active =
    task.dispatch_state === "claimed" || task.dispatch_state === "sent";
  const held = planningHold(task, tasks);
  const closed = task.status === "done" || task.status === "canceled";
  const label = statusLabel(task, tasks);
  const participants = Array.from(
    new Map(
      taskBranch(task, tasks).flatMap((item) =>
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
    <div
      className={cn(
        "group grid min-h-16 grid-cols-[1rem_1.25rem_minmax(0,1fr)] items-center gap-2 rounded-lg px-1 py-2 hover:bg-muted/40 sm:grid-cols-[1rem_1.25rem_minmax(0,1fr)_auto] sm:gap-3 sm:px-2",
        task.accepted === false &&
          "border-violet-300 bg-violet-50/30 border border-dashed",
      )}
    >
      {parent ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${task.title}`}
          aria-expanded={!collapsed}
          className="focus-visible:ring-ring rounded focus-visible:ring-2"
        >
          {collapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
        </button>
      ) : (
        <span />
      )}
      {task.schedule ? (
        <Clock size={18} className="text-muted-foreground" />
      ) : human && !parent ? (
        <input
          type="checkbox"
          checked={task.status === "done"}
          disabled={
            pending ||
            task.accepted === false ||
            active ||
            Boolean(reviewWaitingReason(task, tasks))
          }
          onChange={() =>
            onCommand({
              operation: task.status === "done" ? "reopen" : "complete",
            })
          }
          aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`}
          className="accent-violet-600 focus-visible:ring-ring size-4 cursor-pointer rounded focus-visible:ring-2"
        />
      ) : (
        <button
          type="button"
          onClick={onDetails}
          aria-label={`Inspect ${task.title}: ${label}`}
          className={cn(
            "text-xs focus-visible:ring-ring flex size-4 items-center justify-center rounded border border-muted-foreground/50 focus-visible:ring-2",
            task.status === "done" &&
              "border-green-700 bg-green-700 text-white",
            task.status === "working" && "border-violet-600",
            task.status === "needs_you" && "border-amber-600 text-amber-700",
          )}
        >
          {task.status === "done" ? (
            "✓"
          ) : task.status === "working" ? (
            <span className="bg-violet-600 size-1.5 rounded-sm motion-safe:animate-pulse" />
          ) : task.status === "needs_you" ? (
            "!"
          ) : parent && count.done > 0 ? (
            "−"
          ) : null}
        </button>
      )}
      <button
        type="button"
        onClick={onDetails}
        className="focus-visible:ring-ring min-w-0 rounded text-left focus-visible:ring-2"
      >
        <span
          className={cn(
            "text-sm block leading-snug break-words",
            parent && "font-semibold",
            task.status === "done" && "text-muted-foreground",
          )}
        >
          {task.title}
        </span>
        <span
          className={cn(
            "text-xs mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground",
            task.status === "working" && "text-violet-700",
          )}
        >
          {parent ? `${count.done}/${count.total} accepted · ` : null}
          {label}
          {held &&
          !closed &&
          task.accepted !== false &&
          label !== "Execution on hold" ? (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
              <Pause size={11} />
              Execution on hold
            </span>
          ) : null}
          {task.activity && task.activity !== label ? (
            <span className="max-w-full truncate">· {task.activity}</span>
          ) : null}
          {task.project ? (
            <span className="rounded bg-muted px-1.5 py-0.5">
              {task.project}
            </span>
          ) : null}
        </span>
      </button>
      <div className="col-start-3 flex flex-wrap items-center gap-2 sm:col-start-auto sm:flex-nowrap sm:gap-3">
        {task.status === "needs_you" ? (
          <button
            type="button"
            onClick={onDetails}
            className="bg-amber-100 text-xs text-amber-800 rounded-full px-2.5 py-1.5 font-medium"
          >
            {reviewWaitingReason(task, tasks)
              ? "Questions pending"
              : task.question && !task.question.answers
                ? "Answer"
                : "Review"}
          </button>
        ) : null}
        {canStartTask(task, tasks) ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onCommand({ operation: "start" })}
            aria-label={`Start ${task.title}`}
            className="text-xs focus-visible:ring-ring flex min-h-8 items-center gap-1.5 rounded-lg border border-border px-2 hover:bg-muted focus-visible:ring-2"
          >
            <Play size={15} weight="fill" />
            Start
          </button>
        ) : null}
        {task.status === "blocked" &&
        !(task.question && !task.question.answers) ? (
          <TaskAttemptInfo title={task.title} onChat={onChat} />
        ) : task.paused ? (
          <Pause size={16} />
        ) : null}
        {parent && participants.length > 1 ? (
          <button
            type="button"
            onClick={onDetails}
            className="hidden -space-x-2 sm:flex"
            aria-label={`Participants: ${participants.map((p) => p.name).join(", ")}`}
          >
            {participants.slice(0, 3).map((p) => (
              <TaskIdentity key={`${p.kind}:${p.id}`} assignee={p} />
            ))}
            {participants.length > 3 ? (
              <span className="text-xs pl-2">+{participants.length - 3}</span>
            ) : null}
          </button>
        ) : null}
        <TaskAssigneePicker
          task={task}
          assignees={assignees}
          held={held}
          disabled={pending || active}
          onAssign={(assignee) => onCommand({ operation: "assign", assignee })}
          onDismiss={() =>
            onCommand({
              operation: "dismiss_suggestion",
              suggestion_request_id: task.suggestion_request_id ?? "",
            })
          }
        />
        {!task.review_of && !task.schedule && task.status !== "canceled" ? (
          <button
            type="button"
            onClick={onBreakdown}
            disabled={pending}
            aria-label={`Break down ${task.title}`}
            className="text-xs focus-visible:ring-ring flex min-h-8 items-center gap-1.5 rounded-lg border border-border px-2 hover:bg-muted focus-visible:ring-2"
          >
            <TreeStructure size={15} />
            <span className="hidden lg:inline">Break down</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onChat}
          disabled={pending}
          aria-label={`Open chat for ${task.title}`}
          className="text-xs focus-visible:ring-ring flex min-h-8 items-center gap-1.5 rounded-lg border border-border px-2 hover:bg-muted focus-visible:ring-2"
        >
          <ChatCircle size={15} />
          <span className="hidden md:inline">Open chat</span>
        </button>
        <button
          type="button"
          onClick={onDetails}
          aria-label={`Details for ${task.title}`}
          className="focus-visible:ring-ring hidden rounded p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 sm:block"
        >
          <DotsThree size={18} />
        </button>
      </div>
    </div>
  );
}
