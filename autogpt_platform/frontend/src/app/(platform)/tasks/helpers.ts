import type { WorkspaceTask } from "@/app/api/__generated__/models/workspaceTask";

export type Task = WorkspaceTask & { id: string; version: number };
export type TaskView =
  | "All"
  | "Needs you"
  | "Working"
  | "Scheduled"
  | "Suggested"
  | "Done";
export const TASK_VIEWS: TaskView[] = [
  "All",
  "Needs you",
  "Working",
  "Scheduled",
  "Suggested",
  "Done",
];

export function normalizeTasks(tasks: WorkspaceTask[]): Task[] {
  return tasks.flatMap((task) =>
    task.id ? [{ ...task, id: task.id, version: task.version ?? 1 }] : [],
  );
}

export function taskMatches(
  task: Task,
  view: TaskView,
  search: string,
  project: string,
) {
  if (project && task.project !== project) return false;
  if (
    search &&
    !`${task.title} ${task.description ?? ""} ${task.assignee?.name ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
  )
    return false;
  if (view === "Needs you")
    return (
      task.status === "needs_you" &&
      (!task.result ||
        Boolean(task.question && !task.question.answers) ||
        Boolean(task.review_of))
    );
  if (view === "Working") return task.status === "working";
  if (view === "Scheduled") return Boolean(task.schedule);
  if (view === "Suggested")
    return Boolean(task.suggestion) || task.accepted === false;
  if (view === "Done") return task.status === "done";
  return task.status !== "canceled";
}

export function visibleTaskIDs(
  tasks: Task[],
  view: TaskView,
  search: string,
  project: string,
) {
  const visible = new Set(
    tasks
      .filter((task) => taskMatches(task, view, search, project))
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

export function planningHold(task: Task, tasks: Task[]) {
  let current: Task | undefined = task;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.plan_only) return true;
    current = tasks.find((item) => item.id === current?.parent_id);
  }
  return false;
}

export function statusLabel(task: Task) {
  if (task.result && task.status === "needs_you") return "Awaiting acceptance";
  if (task.schedule)
    return task.schedule.paused ? "Schedule paused" : "Scheduled";
  if (task.accepted === false) return "Proposed new work";
  if (task.plan_only) return "Plan only";
  if (task.paused) return task.status === "working" ? "Stopping" : "Paused";
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
    done: "Accepted",
    canceled: "Canceled",
  }[task.status ?? "todo"];
}
