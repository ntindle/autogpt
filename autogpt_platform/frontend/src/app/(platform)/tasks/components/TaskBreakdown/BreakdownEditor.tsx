import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import type { TaskBreakdown } from "@/app/api/__generated__/models/taskBreakdown";
import type { TaskBreakdownSelection } from "@/app/api/__generated__/models/taskBreakdownSelection";
import { Button } from "@/components/atoms/Button/Button";
import { BreakdownStepRow } from "./BreakdownStepRow";
import type { useBreakdownEditor } from "./useBreakdownEditor";

interface Props {
  editor: ReturnType<typeof useBreakdownEditor>;
  assignees: TaskAssignee[];
  disabled: boolean;
  busy?: boolean;
  refreshState?: TaskBreakdown["state"];
  delegated: boolean;
  held: boolean;
  onAccept: (
    steps: TaskBreakdownSelection[],
    previewID?: string,
  ) => Promise<void>;
}

export function BreakdownEditor({
  editor,
  assignees,
  disabled,
  busy = false,
  refreshState,
  delegated,
  held,
  onAccept,
}: Props) {
  return (
    <>
      {editor.hasUpdate ? (
        <div
          className="space-y-2 rounded-lg bg-muted p-3 text-sm"
          role="status"
        >
          <p>
            An updated suggestion is ready. Your current edits are kept until
            you review it.
          </p>
          <Button
            size="small"
            variant="secondary"
            onClick={editor.reviewUpdate}
          >
            Review updated suggestion
          </Button>
        </div>
      ) : null}
      <ol className="overflow-hidden rounded-xl border border-border bg-background">
        {editor.steps.map((step, index) => (
          <BreakdownStepRow
            key={step.id}
            step={step}
            index={index}
            editor={editor}
            assignees={assignees}
            disabled={busy}
          />
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          {delegated
            ? held
              ? "Confirmed owners inherit the planning hold. Execution stays on hold."
              : "This outcome is already delegated. Accepted steps start when their dependencies are ready."
            : "Owners remain suggestions. Confirm ownership when you are ready to delegate."}{" "}
          Every step can be broken down again.
        </p>
        <Button
          size="small"
          disabled={
            disabled ||
            Boolean(refreshState) ||
            editor.hasUpdate ||
            !editor.selected.length ||
            editor.selected.some((step) => !step.title.trim())
          }
          onClick={() =>
            onAccept(
              editor.selected.map(({ id, title, description, assignee }) => ({
                id,
                title: title.trim(),
                description: description ?? "",
                assignee,
              })),
              editor.previewID,
            )
          }
        >
          {refreshState === "error"
            ? "Generate again before accepting"
            : refreshState
              ? "Updating suggestion…"
              : editor.hasUpdate
                ? "Review update before accepting"
                : disabled
                  ? "Accept steps when ready"
                  : `Accept ${editor.selected.length} selected ${editor.selected.length === 1 ? "step" : "steps"}`}
        </Button>
      </div>
    </>
  );
}
