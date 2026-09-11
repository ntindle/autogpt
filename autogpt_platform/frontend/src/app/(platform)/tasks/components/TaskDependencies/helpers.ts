import { taskBranch, type Task } from "../../helpers";

export function dependencyChoices(
  task: Task,
  tasks: Task[],
  selected: string[],
  search: string,
) {
  const excluded = new Set(taskBranch(task, tasks).map((item) => item.id));
  const byID = new Map(tasks.map((item) => [item.id, item]));
  let parentID = task.parent_id;
  while (parentID && !excluded.has(parentID)) {
    excluded.add(parentID);
    parentID = byID.get(parentID)?.parent_id;
  }
  const query = search.trim().toLowerCase();
  return tasks.filter(
    (item) =>
      !excluded.has(item.id) &&
      !selected.includes(item.id) &&
      !item.schedule &&
      !item.review_of &&
      item.status !== "canceled" &&
      `${item.title} ${item.project ?? ""}`.toLowerCase().includes(query),
  );
}
