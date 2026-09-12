import {
  useCommandWorkspaceTask,
  useListWorkspaceTasks,
} from "@/app/api/__generated__/endpoints/tasks/tasks";
import type { TaskCommand } from "@/app/api/__generated__/models/taskCommand";
import { invalidateTaskSurfaces } from "@/lib/taskSync";
import { okData } from "@/app/api/helpers";
import { useToast } from "@/components/molecules/Toast/use-toast";
import { useAuth } from "@/lib/auth/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { normalizeTasks, selfIdentity, type Task } from "./helpers";
import { useTaskCapture } from "./useTaskCapture";
import { useTaskBreakdown } from "./useTaskBreakdown";
import { useTaskView } from "./useTaskView";

export function useTasksPage() {
  const { user } = useAuth();
  const query = useListWorkspaceTasks({
    query: { select: okData, refetchInterval: 5000 },
  });
  const mutate = useCommandWorkspaceTask();
  const cache = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const tasks = normalizeTasks(query.data?.tasks ?? []);
  const view = useTaskView(user?.id ?? "signed-out");

  async function refresh() {
    await invalidateTaskSurfaces(cache);
  }

  async function command(task: Task, action: Omit<TaskCommand, "version">) {
    const response = await mutate.mutateAsync({
      taskId: task.id,
      data: { ...action, version: task.version },
    });
    const updated = okData(response);
    if (!updated)
      throw new Error("The task could not be updated. Refresh and try again.");
    await refresh();
    return updated;
  }

  async function act(task: Task, action: Omit<TaskCommand, "version">) {
    try {
      return await command(task, action);
    } catch (error) {
      report(error);
    }
  }

  function report(error: unknown) {
    toast({
      title: "Could not update task",
      description: error instanceof Error ? error.message : "Please try again.",
      variant: "destructive",
    });
  }

  async function openChat(item: Task) {
    const task =
      tasks.find((candidate) => candidate.id === item.review_of) ?? item;
    if (task.session_id) {
      router.push(`/copilot?sessionId=${encodeURIComponent(task.session_id)}`);
      return;
    }
    const updated = await act(task, { operation: "discuss" });
    if (updated?.session_id)
      router.push(
        `/copilot?sessionId=${encodeURIComponent(updated.session_id)}`,
      );
  }

  const captureState = useTaskCapture({
    project: view.project,
    refresh,
    report,
  });

  const breakdown = useTaskBreakdown({
    tasks,
    refresh,
    onOpen: () => view.update({ selected: null }),
    onAccepted: (taskId: string) =>
      view.update({ collapsed: view.collapsed.filter((id) => id !== taskId) }),
  });

  return {
    ...captureState,
    breakdown,
    tasks,
    assignees: (query.data?.assignees ?? []).map(
      (owner) => selfIdentity(owner, user?.id ?? "") ?? owner,
    ),
    query,
    view,
    act,
    command,
    openChat,
    pending: mutate.isPending || captureState.isCapturing,
  };
}
