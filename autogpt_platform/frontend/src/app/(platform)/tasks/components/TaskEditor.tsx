import { Button } from "@/components/atoms/Button/Button";
import { Input } from "@/components/atoms/Input/Input";
import { Textarea } from "@/components/ui/textarea";
import type { TaskCommand } from "@/app/api/__generated__/models/taskCommand";
import { TaskDependencies } from "./TaskDependencies/TaskDependencies";
import { useTaskEditor } from "./useTaskEditor";
import type { Task } from "../helpers";

interface Props {
  task: Task;
  tasks: Task[];
  pending: boolean;
  onCommand: (command: Omit<TaskCommand, "version">) => Promise<unknown>;
}

export function TaskEditor({ task, tasks, pending, onCommand }: Props) {
  const editor = useTaskEditor(task, onCommand);
  return (
    <form className="space-y-4" onSubmit={editor.save}>
      <label className="block space-y-1.5 text-xs font-medium">
        Task
        <Input
          id="task-title"
          label="Task title"
          hideLabel
          aria-label="Task title"
          value={editor.title}
          onChange={(event) => editor.setTitle(event.target.value)}
          maxLength={500}
        />
      </label>
      <label className="block space-y-1.5 text-xs font-medium">
        What does done look like?
        <Textarea
          aria-label="Task description"
          value={editor.description}
          onChange={(event) => editor.setDescription(event.target.value)}
          rows={4}
          placeholder="Context, constraints, and the outcome you need."
        />
      </label>
      <label className="block space-y-1.5 text-xs font-medium">
        Project
        <Input
          id="task-project"
          label="Task project"
          hideLabel
          aria-label="Task project"
          placeholder="Optional"
          value={editor.project}
          onChange={(event) => editor.setProject(event.target.value)}
          maxLength={100}
        />
      </label>
      <TaskDependencies
        task={task}
        tasks={tasks}
        selected={editor.dependencies}
        disabled={pending}
        onChange={editor.setDependencies}
      />
      {editor.dirty ? (
        <Button
          type="submit"
          size="small"
          disabled={pending || !editor.title.trim()}
        >
          Save changes
        </Button>
      ) : null}
    </form>
  );
}
