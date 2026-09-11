import { Input } from "@/components/atoms/Input/Input";
import { useState } from "react";
import { statusLabel, type Task } from "../../helpers";
import { dependencyChoices } from "./helpers";

interface Props {
  task: Task;
  tasks: Task[];
  selected: string[];
  disabled: boolean;
  onChange: (dependencies: string[]) => void;
}

export function TaskDependencies({
  task,
  tasks,
  selected,
  disabled,
  onChange,
}: Props) {
  const [search, setSearch] = useState("");
  const choices = dependencyChoices(task, tasks, selected, search);
  function toggle(id: string, checked: boolean) {
    onChange(
      checked ? [...selected, id] : selected.filter((value) => value !== id),
    );
  }
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-xs font-medium">Waiting for</legend>
      <p className="text-xs text-muted-foreground">
        Choose prerequisites from any project. Work starts after all are
        completed.
      </p>
      {selected.length ? (
        <div className="space-y-1 rounded-lg border border-border p-2">
          {selected.map((id) => (
            <DependencyOption
              key={id}
              id={id}
              task={tasks.find((item) => item.id === id)}
              selected
              onToggle={toggle}
            />
          ))}
        </div>
      ) : null}
      <Input
        id="task-dependency-search"
        label="Find prerequisites across projects"
        hideLabel
        aria-label="Find prerequisites across projects"
        placeholder="Search task or project"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
        {choices.length ? (
          choices.map((item) => (
            <DependencyOption
              key={item.id}
              id={item.id}
              task={item}
              selected={false}
              onToggle={toggle}
            />
          ))
        ) : (
          <p className="p-2 text-xs text-muted-foreground">
            No matching prerequisites
          </p>
        )}
      </div>
    </fieldset>
  );
}

function DependencyOption({
  id,
  task,
  selected,
  onToggle,
}: {
  id: string;
  task: Task | undefined;
  selected: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const title = task?.title ?? "Unavailable prerequisite";
  const project = task?.project || "No project";
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted">
      <input
        type="checkbox"
        checked={selected}
        aria-label={`Wait for ${title} (${project})`}
        onChange={(event) => onToggle(id, event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-violet-600"
      />
      <span className="min-w-0 text-sm">
        <span className="block break-words">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {project} · {task ? statusLabel(task) : "Remove or replace this link"}
        </span>
      </span>
    </label>
  );
}
