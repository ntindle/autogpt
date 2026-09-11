import Link from "next/link";
import { useGetWorkspaceTaskContext } from "@/app/api/__generated__/endpoints/tasks/tasks";
import { okData } from "@/app/api/helpers";
import { TaskIdentity } from "../../../tasks/components/TaskIdentity";

interface Props {
  sessionId: string;
}

export function TaskConversationContext({ sessionId }: Props) {
  const query = useGetWorkspaceTaskContext(sessionId, {
    query: { select: okData, refetchInterval: 5000 },
  });
  if (query.isLoading)
    return (
      <p role="status" className="px-5 py-3 text-sm text-muted-foreground">
        Loading task context…
      </p>
    );
  if (!query.data)
    return (
      <p className="px-5 py-3 text-sm text-muted-foreground">
        Could not load task context.{" "}
        <Link className="underline" href="/tasks">
          Return to Tasks
        </Link>
      </p>
    );
  const { task, ancestors, children } = query.data;
  return (
    <section
      aria-label="Linked task context"
      className="shrink-0 border-b border-border bg-background px-5 py-3 md:px-8"
    >
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {[task.project, ...ancestors.map((parent) => parent.title)]
                .filter(Boolean)
                .join(" / ") || "Linked task"}
            </p>
            <h2 className="mt-1 break-words text-sm font-semibold">
              {task.title}
            </h2>
          </div>
          <Link
            href="/tasks"
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            Back to Tasks
          </Link>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <TaskIdentity assignee={task.assignee} />
          <span>
            {task.assignee?.name ?? "Unassigned"} ·{" "}
            {task.plan_only
              ? "Plan only"
              : task.paused
                ? "Paused"
                : task.status?.replaceAll("_", " ")}
          </span>
        </div>
        {task.description ? (
          <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
            {task.description}
          </p>
        ) : null}
        {children.length || task.result || task.question ? (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              {children.length
                ? `${children.length} steps`
                : "Task decisions and result"}
              {task.question && !task.question.answers
                ? " · Waiting for your answer"
                : ""}
            </summary>
            <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
              {children.map((child) => (
                <p key={child.id}>
                  {child.title} · {child.assignee?.name ?? "Unassigned"} ·{" "}
                  {child.status?.replaceAll("_", " ")}
                </p>
              ))}
              {task.question?.questions.map((question) => (
                <p key={question.keyword}>
                  {question.question}
                  {task.question?.answers?.[question.keyword]
                    ? ` — ${task.question.answers[question.keyword]}`
                    : ""}
                </p>
              ))}
              {task.result ? (
                <p className="whitespace-pre-wrap">{task.result}</p>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
