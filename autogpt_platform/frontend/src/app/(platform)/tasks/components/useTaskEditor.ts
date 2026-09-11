import type { TaskCommand } from "@/app/api/__generated__/models/taskCommand";
import { useState, type FormEvent } from "react";
import type { Task } from "../helpers";

export function useTaskEditor(
  task: Task,
  onCommand: (command: Omit<TaskCommand, "version">) => Promise<unknown>,
) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [project, setProject] = useState(task.project ?? "");
  const [dependencyDraft, setDependencies] = useState<string[] | null>(null);
  const dependencies = dependencyDraft ?? task.dependencies ?? [];
  const dirty =
    title !== task.title ||
    description !== (task.description ?? "") ||
    project !== (task.project ?? "") ||
    dependencies.length !== (task.dependencies?.length ?? 0) ||
    dependencies.some((id) => !task.dependencies?.includes(id));

  async function save(event: FormEvent) {
    event.preventDefault();
    const saved = await onCommand({
      operation: "edit",
      title,
      description,
      project,
      dependencies,
    });
    if (saved) setDependencies(null);
  }

  return {
    title,
    setTitle,
    description,
    setDescription,
    project,
    setProject,
    dependencies,
    setDependencies,
    dirty,
    save,
  };
}
