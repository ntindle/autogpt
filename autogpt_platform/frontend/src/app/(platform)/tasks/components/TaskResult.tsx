import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/atoms/Button/Button";
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

export function TaskResult({ task, tasks, pending, onCommand }: Props) {
  const [feedback, setFeedback] = useState("");
  const resultTask = tasks.find((item) => item.id === task.review_of) ?? task;
  if (!resultTask.result) return null;
  const active =
    resultTask.dispatch_state === "sent" ||
    resultTask.dispatch_state === "claimed";
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-muted/30 p-4"
      aria-label="Task result"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Result</h3>
        <span className="text-xs text-muted-foreground">
          Version {resultTask.result_version}
        </span>
      </div>
      <div className="break-words text-sm">
        <MessageResponse>{resultTask.result}</MessageResponse>
      </div>
      {resultTask.status === "needs_you" ? (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Accepting this result confirms the displayed outcome. It does not
            authorize a separate action such as publishing or sending.
          </p>
          <Button
            size="small"
            disabled={pending || active}
            onClick={() => onCommand({ operation: "accept_result" })}
          >
            {active ? "Waiting for the attempt to finish" : "Accept result"}
          </Button>
          <Textarea
            aria-label="Requested changes"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="What needs to change?"
            rows={2}
          />
          <Button
            size="small"
            variant="secondary"
            disabled={pending || active || !feedback.trim()}
            onClick={() =>
              onCommand({ operation: "request_changes", feedback })
            }
          >
            Request changes
          </Button>
        </div>
      ) : null}
    </section>
  );
}
