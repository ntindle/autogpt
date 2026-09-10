import { Button } from "@/components/atoms/Button/Button";
import { Textarea } from "@/components/ui/textarea";
import { isKey } from "@/lib/keyboard";
import type { useTasksPage } from "../useTasksPage";

interface Props {
  page: ReturnType<typeof useTasksPage>;
}

export function TaskCapture({ page }: Props) {
  const parent = page.tasks.find((task) => task.id === page.addParent);
  return (
    <div className="shrink-0 border-t border-border px-4 py-4 sm:px-8">
      {parent ? (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          Add a step to {parent.title}
          <button
            type="button"
            className="underline"
            onClick={() => page.setAddParent(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          page.capture();
        }}
        className="flex items-end gap-3 rounded-xl border border-border bg-background p-2 pl-3 shadow-sm focus-within:ring-1 focus-within:ring-violet-500"
      >
        <Textarea
          disabled={page.isCapturing}
          id="task-capture"
          aria-label={parent ? "Add a subtask" : "Add a task"}
          placeholder={
            parent ? "What is the next step?" : "Add a task, or paste a list…"
          }
          value={page.draft}
          onChange={(event) => page.setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (isKey(event, "Enter") && !event.shiftKey) {
              event.preventDefault();
              page.capture();
            }
          }}
          rows={
            page.draft.includes("\n")
              ? Math.min(page.draft.split("\n").length, 5)
              : 1
          }
          className="min-h-8 resize-none border-0 bg-transparent p-1 text-sm shadow-none focus-visible:ring-0"
        />
        <Button
          type="submit"
          size="small"
          disabled={page.pending || !page.draft.trim()}
        >
          Add
        </Button>
      </form>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Enter to add · Shift + Enter for another line · Assigning an agent
        delegates the work
      </p>
    </div>
  );
}
