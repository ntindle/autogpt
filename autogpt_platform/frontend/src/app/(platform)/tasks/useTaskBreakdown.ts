import { useState } from "react";
import {
  usePreviewWorkspaceTaskBreakdown,
  useAcceptWorkspaceTaskBreakdown,
} from "@/app/api/__generated__/endpoints/tasks/tasks";
import type { TaskBreakdownRequest } from "@/app/api/__generated__/models/taskBreakdownRequest";
import type { TaskBreakdownSelection } from "@/app/api/__generated__/models/taskBreakdownSelection";
import { okData } from "@/app/api/helpers";
import type { Task } from "./helpers";

interface Props {
  tasks: Task[];
  refresh: () => Promise<void>;
  onOpen: () => void;
  onAccepted: (taskId: string) => void;
}

export function useTaskBreakdown({
  tasks,
  refresh,
  onOpen,
  onAccepted,
}: Props) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const preview = usePreviewWorkspaceTaskBreakdown();
  const accept = useAcceptWorkspaceTaskBreakdown();
  const task = tasks.find((item) => item.id === taskId);

  async function generate(item: Task, data: TaskBreakdownRequest = {}) {
    setError("");
    try {
      const response = await preview.mutateAsync({ taskId: item.id, data });
      if (!okData(response))
        throw new Error("Could not request a breakdown. Please try again.");
      await refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not request a breakdown.",
      );
    }
  }

  function open(item: Task) {
    setTaskId(item.id);
    setError("");
    onOpen();
    if (!item.breakdown || item.breakdown.state === "accepted")
      void generate(item);
  }

  async function acceptSteps(
    steps: TaskBreakdownSelection[],
    previewID?: string,
  ) {
    if (!task?.breakdown?.id) return;
    setError("");
    try {
      const response = await accept.mutateAsync({
        taskId: task.id,
        data: { preview_id: previewID ?? task.breakdown.id, steps },
      });
      if (!okData(response))
        throw new Error(
          "The task changed. Generate a fresh breakdown before accepting.",
        );
      await refresh();
      onAccepted(task.id);
      setTaskId(null);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not accept the steps. Please try again.",
      );
    }
  }

  return {
    task,
    open,
    generate,
    acceptSteps,
    error,
    requesting: preview.isPending,
    accepting: accept.isPending,
    close: () => setTaskId(null),
  };
}
