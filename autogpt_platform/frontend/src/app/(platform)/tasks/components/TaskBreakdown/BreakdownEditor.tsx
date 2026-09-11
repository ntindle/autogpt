import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import type { TaskBreakdown } from "@/app/api/__generated__/models/taskBreakdown";
import type { TaskBreakdownSelection } from "@/app/api/__generated__/models/taskBreakdownSelection";
import { Button } from "@/components/atoms/Button/Button";
import { Input } from "@/components/atoms/Input/Input";
import { TaskIdentity } from "../TaskIdentity";
import { useBreakdownEditor } from "./useBreakdownEditor";

interface Props {
  preview: TaskBreakdown;
  assignees: TaskAssignee[];
  disabled: boolean;
  delegated: boolean;
  held: boolean;
  onAccept: (steps: TaskBreakdownSelection[]) => Promise<void>;
}

export function BreakdownEditor({
  preview,
  assignees,
  disabled,
  delegated,
  held,
  onAccept,
}: Props) {
  const editor = useBreakdownEditor(preview);
  return (
    <>
      <ol className="space-y-3">
        {editor.steps.map((step, index) => (
          <li key={step.id} className="rounded-xl border border-border p-3">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                aria-label={`Include step ${index + 1}`}
                checked={step.selected}
                onChange={(event) =>
                  editor.toggle(step.id, event.target.checked)
                }
                className="size-4 shrink-0 accent-violet-600"
              />
              <Input
                id={`breakdown-${step.id}`}
                label={`Step ${index + 1}`}
                hideLabel
                size="small"
                value={step.title}
                maxLength={500}
                onChange={(event) =>
                  editor.edit(step.id, { title: event.target.value })
                }
                wrapperClassName="flex-1"
              />
            </div>
            <p className="mt-2 pl-7 text-xs leading-relaxed text-muted-foreground">
              {step.description}
            </p>
            <div className="mt-3 flex items-center gap-2 pl-7">
              <TaskIdentity assignee={step.assignee} suggested />
              <label className="min-w-0 flex-1 text-xs text-muted-foreground">
                Suggested owner
                <select
                  aria-label={`Owner for step ${index + 1}`}
                  value={step.assignee?.id ?? ""}
                  onChange={(event) =>
                    editor.edit(step.id, {
                      assignee:
                        assignees.find(
                          (owner) => owner.id === event.target.value,
                        ) ?? null,
                    })
                  }
                  className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                >
                  <option value="">Leave unassigned</option>
                  {assignees.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                      {owner.role ? ` · ${owner.role}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {step.assignee?.reason ? (
              <p className="mt-2 pl-7 text-xs text-muted-foreground">
                {step.assignee.reason}
              </p>
            ) : null}
            {step.dependencies?.length ? (
              <p className="mt-2 pl-7 text-xs text-muted-foreground">
                After:{" "}
                {step.dependencies
                  .map(
                    (id) => editor.steps.find((item) => item.id === id)?.title,
                  )
                  .join("; ")}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="sticky bottom-0 space-y-3 border-t border-border bg-background py-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {delegated
            ? held
              ? "Confirmed owners inherit the planning hold. Execution stays on hold."
              : "This outcome is already delegated. Accepted steps start when their dependencies are ready."
            : "Owners remain suggestions. Confirm ownership when you are ready to delegate."}{" "}
          Every step can be broken down again.
        </p>
        <Button
          disabled={
            disabled ||
            !editor.selected.length ||
            editor.selected.some((step) => !step.title.trim())
          }
          onClick={() =>
            onAccept(
              editor.selected.map(({ id, title, assignee }) => ({
                id,
                title: title.trim(),
                assignee,
              })),
            )
          }
        >
          {disabled
            ? "Adding steps…"
            : `Accept ${editor.selected.length} selected ${editor.selected.length === 1 ? "step" : "steps"}`}
        </Button>
      </div>
    </>
  );
}
