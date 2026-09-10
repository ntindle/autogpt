import { useEffect } from "react";
import type { useTasksPage } from "../useTasksPage";
import { visibleTaskIDs } from "../helpers";
import { TaskRow } from "./TaskRow";

interface Props {
  page: ReturnType<typeof useTasksPage>;
}

export function TaskList({ page }: Props) {
  const { tasks, view } = page;
  const { scroll, scrollRef } = view;
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scroll;
  }, [scroll, scrollRef]);
  const visible = visibleTaskIDs(tasks, view.filter, view.search, view.project);
  function renderBranch(parentID: string | null, depth: number) {
    if (depth > 20) return null;
    return (
      <ul
        className={
          depth ? "ml-3 border-l border-border pl-2 sm:ml-5 sm:pl-3" : ""
        }
      >
        {tasks
          .filter(
            (task) =>
              (task.parent_id ?? null) === parentID && visible.has(task.id),
          )
          .map((task) => (
            <li key={task.id}>
              <TaskRow
                task={task}
                tasks={tasks}
                assignees={page.assignees}
                collapsed={view.collapsed.includes(task.id)}
                pending={page.pending}
                onToggle={() => view.toggle(task.id)}
                onDetails={() => view.update({ selected: task.id })}
                onChat={() => page.openChat(task)}
                onCommand={(command) => page.act(task, command)}
              />
              {!view.collapsed.includes(task.id)
                ? renderBranch(task.id, depth + 1)
                : null}
            </li>
          ))}
      </ul>
    );
  }
  return (
    <div
      ref={view.scrollRef}
      onScroll={(event) =>
        view.update({ scroll: event.currentTarget.scrollTop })
      }
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6"
      aria-label="Task checklist"
    >
      {visible.size ? (
        renderBranch(null, 0)
      ) : (
        <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
          <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-violet-100 text-2xl text-violet-600">
            ✓
          </div>
          <h2 className="text-lg font-semibold">
            {tasks.length
              ? "Nothing in this view"
              : "What would you like to get done?"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {tasks.length
              ? "Try another filter or add a task."
              : "Add a task or paste a whole list. Keep some for yourself and hand others to Auto or your Experts."}
          </p>
        </div>
      )}
    </div>
  );
}
