import { Button } from "@/components/atoms/Button/Button";
import { Input } from "@/components/atoms/Input/Input";
import { Textarea } from "@/components/ui/textarea";
import type { TaskCommand } from "@/app/api/__generated__/models/taskCommand";
import { useState } from "react";
import type { Task } from "../helpers";

interface Props {
  task: Task;
  tasks: Task[];
  pending: boolean;
  onCommand: (command: Omit<TaskCommand, "version">) => Promise<unknown>;
}

export function TaskEditor({ task, tasks, pending, onCommand }: Props) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [project, setProject] = useState(task.project ?? "");
  const [dependency, setDependency] = useState(task.dependencies?.[0] ?? "");
  const dirty =
    title !== task.title ||
    description !== (task.description ?? "") ||
    project !== (task.project ?? "") ||
    dependency !== (task.dependencies?.[0] ?? "");
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onCommand({
          operation: "edit",
          title,
          description,
          project,
          dependencies: dependency ? [dependency] : [],
        });
      }}
    >
      <label className="block space-y-1.5 text-xs font-medium">
        Task
        <Input
          id="task-title"
          label="Task title"
          hideLabel
          aria-label="Task title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={500}
        />
      </label>
      <label className="block space-y-1.5 text-xs font-medium">
        What does done look like?
        <Textarea
          aria-label="Task description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          placeholder="Context, constraints, and the outcome you need."
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5 text-xs font-medium">
          Project
          <Input
            id="task-project"
            label="Task project"
            hideLabel
            aria-label="Task project"
            placeholder="Optional"
            value={project}
            onChange={(event) => setProject(event.target.value)}
            maxLength={100}
          />
        </label>
        <label className="block space-y-1.5 text-xs font-medium">
          Waiting for
          <select
            aria-label="Task dependency"
            className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm font-normal"
            value={dependency}
            onChange={(event) => setDependency(event.target.value)}
          >
            <option value="">No dependency</option>
            {tasks
              .filter(
                (item) =>
                  item.id !== task.id &&
                  !item.schedule &&
                  item.status !== "canceled",
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
          </select>
        </label>
      </div>
      {dirty ? (
        <Button type="submit" size="small" disabled={pending || !title.trim()}>
          Save changes
        </Button>
      ) : null}
    </form>
  );
}
