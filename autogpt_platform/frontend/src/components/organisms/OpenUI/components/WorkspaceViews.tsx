import type { ComponentRenderProps } from "@openuidev/react-lang";
import { useIsStreaming, useTriggerAction } from "@openuidev/react-lang";
import type { z } from "zod/v4";
import * as catalog from "@/lib/openui/catalog";
import { Button } from "@/components/atoms/Button/Button";
import { Icon } from "@/components/atoms/Icon/Icon";
import { ArrowUpRight01Icon, Idea01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useOpenUIActionsDisabled } from "../interactionContext";

export function WorkspaceView({
  props,
  renderNode,
}: ComponentRenderProps<z.infer<typeof catalog.Workspace.props>>) {
  return (
    <div className="space-y-7">
      <div className="pb-1">
        <h2 className="text-xl text-zinc-900 font-semibold tracking-tight">
          {props.title}
        </h2>
        <p className="text-sm text-zinc-600 mt-2 max-w-2xl leading-relaxed">
          {props.description}
        </p>
      </div>
      {renderNode(props.children?.slice(0, 8))}
    </div>
  );
}

export function MetricsView({
  props,
  renderNode,
}: ComponentRenderProps<z.infer<typeof catalog.Metrics.props>>) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3">
      {renderNode(props.items?.slice(0, 4))}
    </div>
  );
}

export function MetricView({
  props,
}: ComponentRenderProps<z.infer<typeof catalog.Metric.props>>) {
  return (
    <div className="border-zinc-200 bg-white min-w-0 rounded-xl border p-3.5">
      <p className="text-xs text-zinc-600 font-medium">{props.label}</p>
      <p
        className={cn(
          "text-zinc-900 my-2 font-semibold tracking-tight break-words",
          (props.value?.length ?? 0) > 8 ? "text-base" : "text-2xl",
        )}
      >
        {props.value}
      </p>
      <p
        className={cn(
          "text-zinc-500 text-[11px] leading-snug",
          props.tone === "positive" && "text-green-700",
          props.tone === "warning" && "text-orange-700",
        )}
      >
        {props.detail}
      </p>
    </div>
  );
}

export function InsightView({
  props,
}: ComponentRenderProps<z.infer<typeof catalog.Insight.props>>) {
  return (
    <div
      className={cn(
        "border-zinc-200 bg-zinc-50 flex gap-3 rounded-xl border p-4",
        props.tone === "positive" && "border-green-100 bg-green-50/50",
        props.tone === "warning" && "border-orange-100 bg-orange-50",
      )}
    >
      <Icon
        icon={Idea01Icon}
        size={20}
        className="text-zinc-600 mt-0.5 shrink-0"
      />
      <div>
        <h3 className="text-sm text-zinc-800 font-medium">{props.title}</h3>
        <p className="text-sm text-zinc-600 mt-1 leading-relaxed">
          {props.body}
        </p>
      </div>
    </div>
  );
}

export function ActionView({
  props,
}: ComponentRenderProps<z.infer<typeof catalog.FollowUp.props>>) {
  const triggerAction = useTriggerAction();
  const isStreaming = useIsStreaming();
  const disabled = useOpenUIActionsDisabled();
  return (
    <Button
      size="small"
      variant="secondary"
      disabled={isStreaming || disabled}
      onClick={() => triggerAction(props.message)}
      rightIcon={<Icon icon={ArrowUpRight01Icon} size={16} />}
    >
      {props.label}
    </Button>
  );
}
