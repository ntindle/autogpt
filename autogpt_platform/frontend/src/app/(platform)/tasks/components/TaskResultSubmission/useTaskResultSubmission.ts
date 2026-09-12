import type { TaskCommand } from "@/app/api/__generated__/models/taskCommand";
import { useState } from "react";
import type { Task } from "../../helpers";

export function useTaskResultSubmission(
  task: Task,
  onCommand: (command: Omit<TaskCommand, "version">) => Promise<unknown>,
) {
  const [evidence, setEvidence] = useState(task.result ?? "");
  const [editing, setEditing] = useState(!task.result);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function edit() {
    setEvidence(task.result ?? "");
    setError("");
    setEditing(true);
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      await onCommand({
        operation: "submit_result",
        evidence: evidence.trim(),
      });
      setEditing(false);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Your result could not be saved. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return { evidence, setEvidence, editing, edit, submitting, error, submit };
}
