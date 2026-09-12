import type { TaskCommand } from "@/app/api/__generated__/models/taskCommand";
import { Button } from "@/components/atoms/Button/Button";
import { Textarea } from "@/components/ui/textarea";
import { useId } from "react";
import type { Task } from "../../helpers";
import { useTaskResultSubmission } from "./useTaskResultSubmission";

interface Props {
  task: Task;
  pending: boolean;
  onCommand: (command: Omit<TaskCommand, "version">) => Promise<unknown>;
}

export function TaskResultSubmission({ task, pending, onCommand }: Props) {
  const form = useTaskResultSubmission(task, onCommand);
  const inputID = useId();
  if (
    task.review_of ||
    task.schedule ||
    task.status === "canceled" ||
    (task.assignee && task.assignee.kind !== "human")
  )
    return null;
  if (!form.editing)
    return (
      <Button size="small" variant="secondary" onClick={form.edit}>
        {task.result ? "Update result" : "Add result"}
      </Button>
    );
  return (
    <form
      className="space-y-3 rounded-xl border border-border p-4"
      aria-label="Submit your result"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit();
      }}
    >
      <label htmlFor={inputID} className="block text-sm font-semibold">
        Your result
      </label>
      <p className="text-xs text-muted-foreground">
        Describe what you finished and include links to the deliverable. This
        completes your work and shares the result with AutoPilot and any tasks
        waiting on it.
      </p>
      <Textarea
        id={inputID}
        value={form.evidence}
        onChange={(event) => form.setEvidence(event.target.value)}
        placeholder="What did you complete? Paste the result or links here."
        rows={4}
        maxLength={20000}
        required
      />
      {form.error ? (
        <p role="alert" className="text-sm text-destructive">
          {form.error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="small"
        disabled={pending || form.submitting || !form.evidence.trim()}
      >
        {form.submitting ? "Submitting…" : "Submit result"}
      </Button>
    </form>
  );
}
