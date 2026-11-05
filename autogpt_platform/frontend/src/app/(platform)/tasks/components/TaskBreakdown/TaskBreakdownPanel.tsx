import { useEffect, useRef, useState } from "react";
import { X, Spinner } from "@phosphor-icons/react";
import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import type { useTaskBreakdown } from "../../useTaskBreakdown";
import { planningHold, type Task } from "../../helpers";
import { TaskIdentity } from "../TaskIdentity";
import { BreakdownEditor } from "./BreakdownEditor";
import { BreakdownConversation } from "./BreakdownConversation";
import { useBreakdownEditor } from "./useBreakdownEditor";

interface Props {
  task: Task;
  breakdown: ReturnType<typeof useTaskBreakdown>;
  tasks: Task[];
  assignees: TaskAssignee[];
}

export function TaskBreakdownPanel({
  task,
  breakdown,
  tasks,
  assignees,
}: Props) {
  const [requestedPreviewID, setRequestedPreviewID] = useState<string>();
  const [messages, setMessages] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const editor = useBreakdownEditor(
    task.breakdown?.state === "ready" || task.breakdown?.steps?.length
      ? task.breakdown
      : undefined,
    requestedPreviewID,
  );
  const waiting = breakdown.requesting || task.breakdown?.state === "pending";
  const active =
    task.dispatch_state === "sent" ||
    task.dispatch_state === "claimed" ||
    task.status === "working";
  const canAccept =
    task.breakdown?.state === "ready" &&
    !waiting &&
    !active &&
    !breakdown.accepting;
  const guidance = task.breakdown?.guidance ?? "";
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, []);

  async function refine(message: string) {
    const response = await breakdown.generate(task, {
      detail: task.breakdown?.detail ?? "steps",
      guidance: [guidance, message].filter(Boolean).join("\n\n"),
      ...(editor.selected.length
        ? {
            preview_id: task.breakdown?.id,
            current_steps: editor.selected.map(
              ({ id, title, description, assignee }) => ({
                id,
                title: title.trim(),
                description: description ?? "",
                assignee,
              }),
            ),
          }
        : {}),
    });
    if (!response?.breakdown) return false;
    setRequestedPreviewID(response.breakdown.id);
    if (message) setMessages((current) => [...current, message]);
    return true;
  }

  return (
    <div
      ref={ref}
      role="region"
      aria-label={`Breakdown for ${task.title}`}
      className="border-violet-200 bg-violet-50/30 mb-4 ml-2 max-w-4xl rounded-2xl border p-3 sm:ml-9 sm:p-4"
    >
      <div className="mb-3 flex items-start gap-2">
        <TaskIdentity
          assignee={{ kind: "auto", id: "auto", name: "AutoPilot" }}
        />
        <div className="flex-1">
          <h3 className="text-sm font-medium">AutoPilot</h3>
          <p className="text-xs mt-0.5 text-muted-foreground">
            Here’s a first pass at the work. Edit a step, open its details, or
            tell me what to change.
          </p>
        </div>
        <button
          type="button"
          onClick={breakdown.close}
          aria-label="Close breakdown"
          className="focus-visible:ring-ring rounded p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2"
        >
          <X size={16} />
        </button>
      </div>
      {messages.length ? (
        <div
          className="mb-3 flex flex-col items-end gap-2"
          aria-label="Breakdown conversation"
        >
          {messages.map((message, index) => (
            <p
              key={index}
              className="bg-violet-100 text-sm max-w-[90%] rounded-2xl rounded-br-md px-3 py-2 whitespace-pre-wrap"
            >
              <span className="text-xs text-violet-700 mb-1 block">You</span>
              {message}
            </p>
          ))}
        </div>
      ) : guidance ? (
        <p className="bg-violet-100/60 text-xs mb-3 rounded-xl px-3 py-2 whitespace-pre-wrap text-muted-foreground">
          {guidance}
        </p>
      ) : null}
      {waiting ? (
        <p
          role="status"
          className="text-xs text-violet-700 mb-3 flex items-center gap-2"
        >
          <Spinner size={14} className="animate-spin" />
          {editor.steps.length
            ? "Updating the preview with your changes…"
            : "Breaking this into actionable steps and matching your Experts…"}
        </p>
      ) : null}
      {breakdown.error ||
      task.breakdown?.error ||
      task.breakdown_refresh?.error ? (
        <p role="alert" className="text-sm text-destructive mb-3">
          {breakdown.error ||
            task.breakdown?.error ||
            task.breakdown_refresh?.error}
        </p>
      ) : null}
      {task.breakdown?.error || task.breakdown_refresh?.error ? (
        <button
          type="button"
          disabled={waiting || breakdown.accepting}
          onClick={() => refine("")}
          className="text-xs mb-3 rounded border border-border px-3 py-1.5"
        >
          Try again
        </button>
      ) : null}
      {task.breakdown_refresh?.state === "pending" ? (
        <p role="status" className="text-xs mb-3 text-muted-foreground">
          Updating this suggestion with new context. Your edits are kept.
        </p>
      ) : null}
      {active ? (
        <p role="status" className="text-xs mb-3 text-muted-foreground">
          Work is running. Stop the attempt in task details before accepting a
          scope change.
        </p>
      ) : null}
      {editor.steps.length ? (
        <BreakdownEditor
          editor={editor}
          assignees={assignees}
          disabled={!canAccept}
          busy={waiting || breakdown.accepting}
          refreshState={task.breakdown_refresh?.state}
          delegated={Boolean(
            task.assignee &&
              task.assignee.kind !== "human" &&
              task.accepted !== false,
          )}
          held={planningHold(task, tasks) || Boolean(task.paused)}
          onAccept={breakdown.acceptSteps}
        />
      ) : !waiting ? (
        <button
          type="button"
          onClick={() => breakdown.generate(task)}
          className="text-sm mb-3 rounded border border-border px-3 py-2"
        >
          Generate again
        </button>
      ) : null}
      <BreakdownConversation
        guidance={guidance}
        pending={waiting}
        disabled={
          breakdown.accepting ||
          editor.hasUpdate ||
          editor.selected.some((step) => !step.title.trim())
        }
        onSend={refine}
      />
    </div>
  );
}
