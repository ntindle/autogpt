import { Button } from "@/components/atoms/Button/Button";
import type { TaskCommand } from "@/app/api/__generated__/models/taskCommand";
import {
  ChatCircle,
  Plus,
  TreeStructure,
  Play,
  Pause,
} from "@phosphor-icons/react";
import { canStartTask, planningHold, type Task } from "../helpers";

interface Props {
  task: Task;
  tasks: Task[];
  pending: boolean;
  onCommand: (command: Omit<TaskCommand, "version">) => Promise<unknown>;
  onAdd: () => void;
  onChat: () => void;
  onBreakdown: () => void;
}

export function TaskActions({
  task,
  tasks,
  pending,
  onCommand,
  onAdd,
  onChat,
  onBreakdown,
}: Props) {
  const active =
    task.dispatch_state === "sent" || task.dispatch_state === "claimed";
  return (
    <div className="flex flex-wrap gap-2">
      {!task.review_of && !task.schedule && task.status !== "canceled" ? (
        <Button
          size="small"
          variant="secondary"
          leftIcon={<TreeStructure size={14} />}
          onClick={onBreakdown}
        >
          Break down
        </Button>
      ) : null}
      <Button
        size="small"
        variant="secondary"
        leftIcon={<ChatCircle size={14} />}
        onClick={onChat}
      >
        Open chat
      </Button>
      <Button
        size="small"
        variant="secondary"
        leftIcon={<Plus size={14} />}
        onClick={onAdd}
      >
        Add step
      </Button>
      {task.status === "done" || task.status === "canceled" ? (
        <Button
          size="small"
          variant="secondary"
          disabled={pending}
          onClick={() => onCommand({ operation: "reopen" })}
        >
          Reopen
        </Button>
      ) : (
        <>
          {canStartTask(task, tasks) ? (
            <Button
              size="small"
              disabled={pending}
              leftIcon={<Play size={14} weight="fill" />}
              onClick={() => onCommand({ operation: "start" })}
            >
              Start work
            </Button>
          ) : null}
          {!planningHold(task, tasks) &&
          !task.schedule &&
          task.accepted !== false ? (
            <Button
              size="small"
              variant="secondary"
              disabled={pending || active}
              leftIcon={<Pause size={14} />}
              onClick={() => onCommand({ operation: "hold" })}
            >
              Hold execution
            </Button>
          ) : null}
          {active && !task.paused ? (
            <Button
              size="small"
              variant="secondary"
              disabled={pending}
              onClick={() => onCommand({ operation: "pause" })}
            >
              Stop attempt
            </Button>
          ) : null}
          {task.accepted === false ? (
            <Button
              size="small"
              disabled={pending}
              onClick={() => onCommand({ operation: "accept_scope" })}
            >
              Accept task
            </Button>
          ) : null}
          <Button
            size="small"
            variant="ghost"
            disabled={pending || active}
            onClick={() => onCommand({ operation: "cancel" })}
          >
            Cancel task
          </Button>
        </>
      )}
    </div>
  );
}
