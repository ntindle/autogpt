import { Button } from "@/components/atoms/Button/Button";
import { Input } from "@/components/atoms/Input/Input";
import { Plus, MagnifyingGlass } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { TASK_VIEWS, taskMatches } from "../helpers";
import type { useTasksPage } from "../useTasksPage";

interface Props {
  page: ReturnType<typeof useTasksPage>;
}

export function TasksHeader({ page }: Props) {
  const projects = Array.from(
    new Set(
      page.tasks
        .map((task) => task.project)
        .filter((project): project is string => Boolean(project)),
    ),
  );
  return (
    <header className="shrink-0 border-b border-border px-4 pb-3 pt-7 sm:px-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-baseline gap-2.5 text-3xl font-semibold tracking-tight">
            Tasks{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {
                page.tasks.filter(
                  (task) => !task.schedule && task.status !== "canceled",
                ).length
              }
            </span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            One list. Shared responsibility.
          </p>
        </div>
        <Button
          variant="secondary"
          size="small"
          leftIcon={<Plus size={14} />}
          onClick={() => document.getElementById("task-capture")?.focus()}
        >
          Add task
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Task views"
        >
          {TASK_VIEWS.map((filter) => (
            <button
              type="button"
              key={filter}
              aria-pressed={page.view.filter === filter}
              onClick={() => page.view.update({ filter })}
              className={cn(
                "rounded-full px-3 py-2 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                page.view.filter === filter &&
                  "bg-muted font-medium text-foreground",
              )}
            >
              {filter}
              {filter === "Needs you" ? (
                <span className="ml-1.5 text-[10px]">
                  {
                    page.tasks.filter((task) =>
                      taskMatches(task, filter, "", ""),
                    ).length
                  }
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="absolute left-2.5 top-2.5 text-muted-foreground"
            />
            <Input
              id="task-search"
              label="Search tasks"
              hideLabel
              wrapperClassName="mb-0"
              aria-label="Search tasks"
              placeholder="Search tasks"
              value={page.view.search}
              onChange={(event) =>
                page.view.update({ search: event.target.value })
              }
              className="h-8 w-36 rounded-full pl-8 text-xs"
            />
          </div>
          <select
            aria-label="Filter by project"
            value={page.view.project}
            onChange={(event) =>
              page.view.update({ project: event.target.value })
            }
            className="h-8 max-w-36 rounded-full border border-border bg-background px-3 text-xs text-muted-foreground"
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project}>{project}</option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}
