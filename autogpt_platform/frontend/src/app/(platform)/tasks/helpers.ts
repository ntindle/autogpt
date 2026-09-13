import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import type { WorkspaceTask } from "@/app/api/__generated__/models/workspaceTask";

export type Task = WorkspaceTask & { id: string; version: number };
export type TaskView =
  | "All"
  | "Needs you"
  | "Working"
  | "Scheduled"
  | "Suggested"
  | "Done"
  | "Canceled";
export const TASK_VIEWS: TaskView[] = [
  "All",
  "Needs you",
  "Working",
  "Scheduled",
  "Suggested",
  "Done",
  "Canceled",
];

export function normalizeTasks(tasks: WorkspaceTask[]): Task[] {
  return tasks.flatMap((task) =>
    task.id
      ? [
          {
            ...task,
            id: task.id,
            version: task.version ?? 1,
            assignee: selfIdentity(task.assignee, task.user_id),
            suggestion: selfIdentity(task.suggestion, task.user_id),
            suggestion_alternatives: task.suggestion_alternatives?.map(
              (owner) => selfIdentity(owner, task.user_id) ?? owner,
            ),
            breakdown: task.breakdown
              ? {
                  ...task.breakdown,
                  steps: task.breakdown.steps?.map((step) => ({
                    ...step,
                    suggestion: selfIdentity(step.suggestion, task.user_id),
                  })),
                }
              : task.breakdown,
          },
        ]
      : [],
  );
}

export function selfIdentity(
  assignee: TaskAssignee | null | undefined,
  userID: string,
) {
  return assignee?.kind === "human" && assignee.id === userID
    ? { ...assignee, name: "You" }
    : assignee;
}

export function foldedReview(task: Task, tasks: Task[]) {
  if (!task.review_of || task.status === "done" || task.status === "canceled")
    return false;
  const source = tasks.find((item) => item.id === task.review_of);
  return Boolean(
    source?.result &&
      ((source.question && !source.question.answers) ||
        source.status !== "needs_you"),
  );
}

export function taskMatches(
  task: Task,
  view: TaskView,
  search: string,
  project: string,
  tasks: Task[] = [],
) {
  if (foldedReview(task, tasks)) return false;
  if (project && task.project !== project) return false;
  if (
    search &&
    !`${task.title} ${task.description ?? ""} ${task.assignee?.name ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
  )
    return false;
  if (task.status === "canceled" || view === "Canceled")
    return task.status === "canceled" && view === "Canceled";
  if (view === "Needs you")
    return (
      task.status === "needs_you" &&
      (!task.result ||
        Boolean(task.question && !task.question.answers) ||
        Boolean(task.review_of))
    );
  if (view === "Working")
    return (
      task.status === "working" ||
      Boolean(
        task.question &&
          !task.question.answers &&
          task.question.questions.some(
            (q) => !q.answer && q.target && q.target.kind !== "human",
          ),
      )
    );
  if (view === "Scheduled") return Boolean(task.schedule);
  if (view === "Suggested")
    return Boolean(task.suggestion) || task.accepted === false;
  if (view === "Done") return task.status === "done";
  return true;
}

export function visibleTaskIDs(
  tasks: Task[],
  view: TaskView,
  search: string,
  project: string,
) {
  const canceled = new Set(
    tasks
      .filter((task) => task.status === "canceled")
      .flatMap((task) => taskBranch(task, tasks).map((member) => member.id)),
  );
  const visible = new Set(
    tasks
      .filter((task) => {
        if (canceled.has(task.id) !== (view === "Canceled")) return false;
        const filter =
          view === "Canceled" && task.status !== "canceled" ? "All" : view;
        return taskMatches(task, filter, search, project, tasks);
      })
      .map((task) => task.id),
  );
  const byID = new Map(tasks.map((task) => [task.id, task]));
  for (const id of Array.from(visible)) {
    let parent = byID.get(id)?.parent_id;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      visible.add(parent);
      parent = byID.get(parent)?.parent_id;
    }
  }
  return visible;
}

export function taskBranch(task: Task, tasks: Task[]): Task[] {
  const ids = new Set([task.id]);
  for (let round = 0; round < tasks.length; round++) {
    const next = tasks.filter(
      (item) => item.parent_id && ids.has(item.parent_id) && !ids.has(item.id),
    );
    if (!next.length) break;
    next.forEach((item) => ids.add(item.id));
  }
  return tasks.filter((item) => ids.has(item.id));
}

export function taskProgress(task: Task, tasks: Task[]) {
  const branch = taskBranch(task, tasks);
  const byID = new Map(branch.map((item) => [item.id, item]));
  const members = branch.filter((item) => {
    let current: Task | undefined = item;
    while (current) {
      if (
        current.accepted === false ||
        current.required === false ||
        current.status === "canceled" ||
        current.schedule
      )
        return false;
      current = current.parent_id ? byID.get(current.parent_id) : undefined;
    }
    return true;
  });
  const parents = new Set(members.map((item) => item.parent_id));
  const leaves = members.filter((item) => !parents.has(item.id));
  return {
    done: leaves.filter((item) => item.status === "done").length,
    total: leaves.length,
  };
}

export function taskLineage(task: Task, tasks: Task[]) {
  const lineage: Task[] = [];
  let current: Task | undefined = task;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    lineage.push(current);
    current = tasks.find((item) => item.id === current?.parent_id);
  }
  return lineage;
}

export function planningHoldSource(task: Task, tasks: Task[]) {
  for (const current of taskLineage(task, tasks)) {
    if (current.plan_only) return current;
    if (current.execution_enabled) return undefined;
  }
}

export function planningHold(task: Task, tasks: Task[]) {
  return Boolean(planningHoldSource(task, tasks));
}

export function unmetPrerequisites(task: Task, tasks: Task[]) {
  const dependencies = new Set(
    taskLineage(task, tasks).flatMap((item) => item.dependencies ?? []),
  );
  return tasks.filter(
    (item) => dependencies.has(item.id) && item.status !== "done",
  );
}

export function canStartTask(task: Task, tasks: Task[]) {
  const lineage = taskLineage(task, tasks);
  if (
    task.status === "done" ||
    task.status === "canceled" ||
    task.schedule ||
    task.review_of
  )
    return false;
  if (
    task.dispatch_state === "claimed" ||
    task.dispatch_state === "sent" ||
    task.status === "working"
  )
    return false;
  if (
    lineage.some(
      (item) => item.accepted === false || item.status === "canceled",
    )
  )
    return false;
  if (lineage.slice(1).some((item) => item.paused)) return false;
  if (
    (task.question && !task.question.answers) ||
    (task.result && task.status === "needs_you")
  )
    return false;
  return (
    (planningHold(task, tasks) ||
      Boolean(task.paused) ||
      task.status === "blocked") &&
    taskBranch(task, tasks).some(
      (item) =>
        item.accepted !== false &&
        item.assignee &&
        item.assignee.kind !== "human" &&
        item.status !== "done" &&
        item.status !== "canceled",
    )
  );
}

export function reviewWaitingReason(task: Task, tasks: Task[]) {
  if (!task.review_of || task.status === "done" || task.status === "canceled")
    return null;
  const result = tasks.find((item) => item.id === task.review_of);
  if (result?.question && !result.question.answers)
    return result.status === "needs_you"
      ? "Answer before review"
      : "Waiting for answers before review";
  if (result && result.status !== "needs_you")
    return "Waiting for an updated result";
  return null;
}

export function statusLabel(task: Task, tasks: Task[] = [task]) {
  const reviewWait = reviewWaitingReason(task, tasks);
  if (reviewWait) return reviewWait;
  if (task.status === "blocked" && task.question && !task.question.answers)
    return task.activity || "Waiting for a teammate";
  if (task.status === "done") return "Completed";
  if (task.status === "canceled") return "Canceled";
  if (task.accepted === false) return "Proposed new work";
  if (task.question && !task.question.answers)
    return task.result
      ? "Draft ready · Answer needed"
      : "Waiting for your answer";
  if (task.result && task.status === "needs_you") return "Awaiting acceptance";
  if (task.schedule)
    return task.schedule.paused ? "Schedule paused" : "Scheduled";
  if (task.paused) return task.status === "working" ? "Stopping" : "Paused";
  if (task.status === "blocked" && task.dispatch_state === "finished")
    return "Attempt stopped";
  if (planningHold(task, tasks)) return "Execution on hold";
  if (unmetPrerequisites(task, tasks).length)
    return "Waiting for prerequisites";
  if (
    task.dispatch_state === "pending" ||
    (task.dispatch_state === "sent" && task.status === "todo")
  )
    return "Queued";
  return {
    todo: "To do",
    working: "Working",
    needs_you: "Needs you",
    blocked: "Blocked",
  }[task.status ?? "todo"];
}
