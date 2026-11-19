import type { ComponentRenderProps } from "@openuidev/react-lang";
import type { z } from "zod/v4";
import type { Checklist } from "@/lib/openui/catalog";
import { cn } from "@/lib/utils";
import { useChecklistView } from "./useChecklistView";

export function ChecklistView({
  props,
  statementId,
}: ComponentRenderProps<z.infer<typeof Checklist.props>>) {
  const items = props.items?.slice(0, 12) ?? [];
  const { completed, disabled, toggle } = useChecklistView(
    items,
    `checklist:${statementId ?? props.title}`,
  );
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm text-zinc-800 font-semibold">{props.title}</h3>
        <span className="text-xs text-zinc-500" aria-live="polite">
          {completed.size} of {items.length} complete
        </span>
      </div>
      <div className="divide-zinc-100 divide-y">
        {items.map((item, index) => (
          <label
            key={index}
            className="flex cursor-pointer gap-3 py-4 first:pt-0 last:pb-0"
          >
            <input
              type="checkbox"
              disabled={disabled}
              checked={completed.has(index)}
              onChange={() => toggle(index)}
              className="accent-purple-500 mt-0.5 size-4 shrink-0"
            />
            <div>
              <span
                className={cn(
                  "text-sm text-zinc-800 font-medium",
                  completed.has(index) && "text-zinc-400 line-through",
                )}
              >
                {item.title}
              </span>
              <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                {item.detail}
              </p>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}
