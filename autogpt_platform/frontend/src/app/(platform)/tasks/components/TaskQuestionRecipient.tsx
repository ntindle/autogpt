import { useState } from "react";
import Link from "next/link";
import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import type { TaskQuestionItem } from "@/app/api/__generated__/models/taskQuestionItem";
import type { WorkspaceTask } from "@/app/api/__generated__/models/workspaceTask";
import { MessageResponse } from "@/components/ai-elements/message";
import { resolveWorkspaceUrls } from "../../copilot/components/ChatMessagesContainer/helpers";

interface Props {
  question: TaskQuestionItem;
  assignees: TaskAssignee[];
  tasks: WorkspaceTask[];
  owner?: TaskAssignee | null;
  onRoute: (keyword: string, target: TaskAssignee) => Promise<unknown>;
}

export function TaskQuestionRecipient({
  question,
  assignees,
  tasks,
  owner,
  onRoute,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const target =
    question.target ?? assignees.find((person) => person.kind === "human");
  const consultation = tasks.find(
    (task) => task.id === question.consultation_task_id,
  );
  const humanOnly = question.purpose && question.purpose !== "clarification";
  const candidates = assignees.filter(
    (person) =>
      person.kind === "human" ||
      (!humanOnly && !(person.kind === owner?.kind && person.id === owner?.id)),
  );
  const name = target?.kind === "human" ? "You" : (target?.name ?? "You");

  async function route(value: string) {
    const recipient = candidates.find(
      (person) => `${person.kind}:${person.id}` === value,
    );
    if (!recipient) return;
    setPending(true);
    setError("");
    try {
      await onRoute(question.keyword, recipient);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not redirect this question. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mb-3 space-y-2">
      {question.answer ? (
        <div className="space-y-1 text-sm">
          <p className="text-xs text-muted-foreground">Answered by {name}</p>
          <MessageResponse>
            {resolveWorkspaceUrls(question.answer)}
          </MessageResponse>
        </div>
      ) : (
        <>
          <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Answer from
            <select
              aria-label={`Who should answer: ${question.question}`}
              value={target ? `${target.kind}:${target.id}` : ""}
              disabled={pending || humanOnly || !candidates.length}
              onChange={(event) => void route(event.target.value)}
              className="min-h-11 max-w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            >
              {target &&
              !candidates.some(
                (person) =>
                  person.kind === target.kind && person.id === target.id,
              ) ? (
                <option value={`${target.kind}:${target.id}`}>{name}</option>
              ) : null}
              {candidates.map((person) => (
                <option
                  key={`${person.kind}:${person.id}`}
                  value={`${person.kind}:${person.id}`}
                >
                  {person.kind === "human" ? "You" : person.name}
                </option>
              ))}
            </select>
            {humanOnly ? (
              <span>
                {question.purpose === "approval"
                  ? "Your approval is needed"
                  : "Account setup needs you"}
              </span>
            ) : null}
          </label>
          {target && target.kind !== "human" ? (
            <p role="status" className="text-xs text-muted-foreground">
              {consultation?.status === "blocked"
                ? `${name}'s attempt stopped. Open their chat or redirect the question.`
                : `Waiting for ${name}. Their answer will return automatically.`}
              {consultation?.session_id ? (
                <Link
                  className="ml-2 underline"
                  href={`/copilot?sessionId=${encodeURIComponent(consultation.session_id)}`}
                >
                  Open question chat
                </Link>
              ) : null}
            </p>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
