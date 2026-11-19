import type { ComponentRenderProps } from "@openuidev/react-lang";
import type { z } from "zod/v4";
import type { Timeline } from "@/lib/openui/catalog-sections";
import { cn } from "@/lib/utils";

const statuses = {
  done: {
    label: "Done",
    color: "bg-green-50 text-green-700",
    dot: "bg-green-500",
  },
  current: {
    label: "Current",
    color: "bg-purple-50 text-purple-700",
    dot: "bg-purple-500",
  },
  planned: {
    label: "Planned",
    color: "bg-zinc-100 text-zinc-600",
    dot: "bg-zinc-300",
  },
};

export function TimelineView({
  props,
}: ComponentRenderProps<z.infer<typeof Timeline.props>>) {
  return (
    <section aria-label={props.title}>
      <h3 className="text-sm text-zinc-800 mb-5 font-semibold">
        {props.title}
      </h3>
      <ol className="border-zinc-200 ml-1 border-l">
        {(props.items ?? []).slice(0, 20).map((item, index) => {
          const status = statuses[item.status] ?? statuses.planned;
          return (
            <li key={index} className="relative space-y-2 pb-6 pl-5 last:pb-0">
              <span
                className={cn(
                  "border-white absolute top-1 -left-1.5 size-3 rounded-full border-2",
                  status.dot,
                )}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-500 font-medium">
                  {item.time}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px]",
                    status.color,
                  )}
                >
                  {status.label}
                </span>
              </div>
              <h4 className="text-sm text-zinc-800 font-medium">
                {item.title}
              </h4>
              <p className="text-xs text-zinc-500 leading-relaxed">
                {item.detail}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
