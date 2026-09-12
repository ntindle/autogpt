import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import {
  useSuggestWorkspaceTaskOwner,
  getListWorkspaceTasksQueryKey,
} from "@/app/api/__generated__/endpoints/tasks/tasks";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Task } from "../../helpers";

interface Props {
  task: Task;
  disabled: boolean;
  onAssign: (assignee: TaskAssignee | null) => Promise<unknown>;
  onDismiss: () => Promise<unknown>;
}

export function useTaskAssigneePicker({
  task,
  disabled,
  onAssign,
  onDismiss,
}: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const focusAfterSave = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const suggest = useSuggestWorkspaceTaskOwner();
  const cache = useQueryClient();
  const identity = task.assignee ?? task.suggestion;
  const suggested = !task.assignee && Boolean(task.suggestion);
  const suggesting =
    !task.assignee &&
    (task.suggestion_state === "pending" || suggest.isPending);
  const busy = disabled || saving;
  useEffect(
    function restoreOwnerFocus() {
      if (busy || !focusAfterSave.current) return;
      focusAfterSave.current = false;
      const trigger = triggerRef.current;
      if (
        document.activeElement === document.body ||
        trigger?.parentElement?.contains(document.activeElement)
      ) {
        trigger?.focus({ preventScroll: true });
      }
    },
    [busy],
  );

  async function change(action: () => Promise<unknown>, restoreFocus = false) {
    if (disabled || savingRef.current) return;
    savingRef.current = true;
    focusAfterSave.current = restoreFocus;
    setSaving(true);
    setError("");
    try {
      const updated = await action();
      if (updated) {
        setOpen(false);
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not update this owner.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function assign(assignee: TaskAssignee | null, restoreFocus = false) {
    await change(() => onAssign(assignee), restoreFocus);
  }

  async function dismiss(restoreFocus = false) {
    await change(onDismiss, restoreFocus);
  }

  async function refreshSuggestion() {
    setError("");
    try {
      await suggest.mutateAsync({ taskId: task.id });
      await cache.invalidateQueries({
        queryKey: getListWorkspaceTasksQueryKey(),
      });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not request a suggestion.",
      );
    }
  }

  return {
    open,
    setOpen,
    busy,
    error,
    identity,
    suggested,
    suggesting,
    triggerRef,
    assign,
    dismiss,
    refreshSuggestion,
  };
}
