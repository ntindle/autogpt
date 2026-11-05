import { useState } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import { TaskIdentity } from "../TaskIdentity";
import type { useBreakdownEditor } from "./useBreakdownEditor";

interface Props {
  step: ReturnType<typeof useBreakdownEditor>["steps"][number];
  index: number;
  editor: ReturnType<typeof useBreakdownEditor>;
  assignees: TaskAssignee[];
  disabled: boolean;
}

export function BreakdownStepRow({
  step,
  index,
  editor,
  assignees,
  disabled,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const prerequisites = step.dependencies ?? [];
  return (
    <li className="border-b border-border/60 last:border-0">
      <div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 px-3 py-2 sm:grid-cols-[1rem_minmax(0,1fr)_auto]">
        <input
          type="checkbox"
          checked={step.selected}
          disabled={disabled}
          onChange={(event) => editor.toggle(step.id, event.target.checked)}
          aria-label={`Include step ${index + 1}`}
          className="accent-violet-600 mt-2 size-3.5"
        />
        <div className="min-w-0">
          <input
            aria-label={`Step ${index + 1}`}
            value={step.title}
            maxLength={500}
            disabled={disabled}
            onChange={(event) =>
              editor.edit(step.id, { title: event.target.value })
            }
            className="text-sm focus:border-ring w-full rounded border border-transparent bg-transparent px-1 py-1 hover:border-border focus:outline-none disabled:opacity-70"
          />
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls={`details-${step.id}`}
            aria-label={`${expanded ? "Hide" : "Show"} details for step ${index + 1}`}
            className="text-xs focus-visible:ring-ring flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2"
          >
            {expanded ? <CaretDown size={11} /> : <CaretRight size={11} />}
            {prerequisites.length
              ? `${prerequisites.length} prerequisite${prerequisites.length === 1 ? "" : "s"} · `
              : ""}
            {expanded ? "Hide details" : "Details"}
          </button>
        </div>
        <div className="border-violet-500 col-start-2 mt-1 flex min-w-0 items-center gap-1 rounded-full border border-dashed pr-1 pl-0.5 sm:col-start-auto sm:mt-0 sm:max-w-48">
          <TaskIdentity assignee={step.assignee} />
          <select
            aria-label={`Owner for step ${index + 1}`}
            value={step.assignee?.id ?? ""}
            disabled={disabled}
            onChange={(event) =>
              editor.edit(step.id, {
                assignee:
                  assignees.find((owner) => owner.id === event.target.value) ??
                  null,
              })
            }
            className="text-xs focus-visible:ring-ring min-w-0 flex-1 rounded border border-transparent bg-transparent py-1 hover:border-border focus-visible:ring-2"
          >
            <option value="">Leave unassigned</option>
            {assignees.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
                {owner.role ? ` · ${owner.role}` : ""}
              </option>
            ))}
          </select>
        </div>
        {expanded ? (
          <div
            id={`details-${step.id}`}
            className="col-start-2 mt-2 space-y-2 pb-1 sm:col-span-2"
          >
            <label className="text-xs block text-muted-foreground">
              Deliverable
              <textarea
                aria-label={`Deliverable for step ${index + 1}`}
                value={step.description ?? ""}
                maxLength={20000}
                rows={2}
                disabled={disabled}
                onChange={(event) =>
                  editor.edit(step.id, { description: event.target.value })
                }
                className="text-sm focus:border-ring mt-1 block w-full resize-y rounded border border-transparent bg-transparent p-1 text-foreground hover:border-border focus:outline-none"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Starts after:{" "}
              {prerequisites.length
                ? prerequisites
                    .map(
                      (id) =>
                        editor.steps.find((item) => item.id === id)?.title ??
                        "A prerequisite step",
                    )
                    .join("; ")
                : "No prerequisites"}
            </p>
            {step.assignee?.reason ? (
              <p className="text-xs text-muted-foreground">
                Why {step.assignee.name}: {step.assignee.reason}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
