import type { RenderUIMessagePart } from "./isRenderUIPart";
import { z } from "zod/v4";
import { MAX_SOURCE_LENGTH } from "@/lib/openui/catalog";
import { MAX_FORM_VALUES } from "@/lib/openui/actions";
import { parseWorkspace } from "@/lib/openui/parse";
import { asObject } from "../../components/ToolChain/resultHelpers";

import type { ChartBlock } from "@/app/api/__generated__/models/chartBlock";
import type { TableBlock } from "@/app/api/__generated__/models/tableBlock";
import { ResponseType } from "@/app/api/__generated__/models/responseType";
import type { UIBlocksResponse } from "@/app/api/__generated__/models/uIBlocksResponse";
import type { Tone } from "@/components/styles/tones";
import type { ToolUIPart } from "ai";

const resultSchema = z.object({
  type: z.literal("ui_rendered"),
  version: z.literal(1),
  source: z.string().max(MAX_SOURCE_LENGTH),
  message: z.string().max(10_000),
  session_id: z.string().nullable().optional(),
  file_id: z.string().nullable().optional(),
  file_name: z.string().nullable().optional(),
});

export interface SavedFileRef {
  id: string;
  name: string | null;
}

export function readSavedFile(
  result: z.infer<typeof resultSchema> | null,
): SavedFileRef | null {
  if (!result?.file_id) return null;
  return { id: result.file_id, name: result.file_name ?? null };
}

export function readViewMeta(source: string) {
  try {
    const root = parseWorkspace(source);
    return {
      valid: true,
      title: String(root.props.title || "Interactive view"),
      viewId: String(root.props.viewId ?? ""),
    };
  } catch {
    return { valid: false, title: "Interactive view", viewId: "" };
  }
}

export function readUIError(part: RenderUIMessagePart) {
  if (part.state === "output-error")
    return part.errorText || "The interactive view could not be prepared.";
  const output =
    part.state === "output-available" ? asObject(part.output) : null;
  if (output?.type !== "error") return null;
  return typeof output.message === "string" && output.message
    ? output.message
    : "The interactive view could not be prepared.";
}

export function readUIResult(part: RenderUIMessagePart) {
  const output =
    part.state === "output-available" ? asObject(part.output) : null;
  const parsed = resultSchema.safeParse(output);
  if (!parsed.success) {
    return {
      result: null,
      title: "Interactive view",
      valid: false,
      summary: typeof output?.message === "string" ? output.message : "",
    };
  }
  try {
    const root = parseWorkspace(parsed.data.source);
    return {
      result: parsed.data,
      title: String(root.props.title || "Interactive view"),
      valid: true,
      summary: parsed.data.message,
    };
  } catch {
    return {
      result: parsed.data,
      title: "Interactive view",
      valid: false,
      summary: parsed.data.message,
    };
  }
}

export function getStreamingSource(part: RenderUIMessagePart) {
  let input = asObject(part.input);
  if (
    part.type === "tool-run_capability" ||
    (part.type === "dynamic-tool" && part.toolName === "run_capability")
  )
    input = asObject(input?.input);
  return typeof input?.source === "string"
    ? input.source.slice(0, MAX_SOURCE_LENGTH)
    : "";
}

export function buildUIFollowUp(
  message: string,
  title: string,
  fields: Record<string, unknown>,
) {
  const values = Object.entries(fields)
    .slice(0, MAX_FORM_VALUES)
    .map(([name, value]) => [name.slice(0, 200), value]);
  const body = message.trim().slice(0, 2000);
  const result = `${body}\n\nFrom the interactive view: ${title.slice(0, 200)}${values.length ? `\nSubmitted values:\n${JSON.stringify(Object.fromEntries(values), null, 2)}` : ""}`;
  if (result.length > 64_000)
    throw new Error(
      "This submission exceeds the chat message limit. Download the data or submit a smaller selection; your edits are still here.",
    );
  return result;
}

export function readUIDraft(
  key: string,
  source: string,
): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 80_000) return {};
    const value = asObject(JSON.parse(raw));
    return value?.source === source ? (asObject(value.state) ?? {}) : {};
  } catch {
    return {};
  }
}

export function saveUIDraft(
  key: string,
  source: string,
  state: Record<string, unknown>,
) {
  try {
    const value = JSON.stringify({ source, state });
    if (value.length <= 80_000) sessionStorage.setItem(key, value);
  } catch {}
}

export const RENDER_UI_PART_TYPE = "tool-render_ui";

export type UIBlock = NonNullable<UIBlocksResponse["blocks"]>[number];
export type BlockTone = "neutral" | "positive" | "negative" | "warning";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isObjectList(value: unknown) {
  return Array.isArray(value) && value.every(isObject);
}

// What each block's view reads as a list, so a malformed stored block is
// skipped instead of breaking the cards next to it. A type missing here is
// one this tab is too old to know, and it is skipped too.
const BLOCK_CHECKS: Record<
  string,
  (block: Record<string, unknown>) => boolean
> = {
  stats: (block) => isObjectList(block.items),
  chart: (block) =>
    Array.isArray(block.x_labels) &&
    isObjectList(block.series) &&
    (block.series as Record<string, unknown>[]).every((series) =>
      Array.isArray(series.values),
    ),
  workflow_diagram: (block) => isObjectList(block.steps),
  gallery: (block) => isObjectList(block.images),
  timeline: (block) => isObjectList(block.items),
  options: (block) => isObjectList(block.items),
  table: (block) =>
    Array.isArray(block.columns) &&
    Array.isArray(block.rows) &&
    block.rows.every(Array.isArray),
};

export const TEXT_TONE: Record<BlockTone, Tone> = {
  neutral: "muted",
  positive: "success",
  negative: "error-strong",
  warning: "warning",
};

export const CHART_LEGEND_CLASSES = ["bg-brand", "bg-sky", "bg-orange"];

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return toRecord(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return isObject(value) ? value : null;
}

function isRenderable(value: unknown): value is UIBlock {
  if (!isObject(value)) return false;
  const check = BLOCK_CHECKS[String(value.type)];
  return Boolean(check) && check(value);
}

export function parseUIBlocks(
  part: ToolUIPart | RenderUIMessagePart,
): UIBlock[] | null {
  const output = toRecord(part.output);
  if (!output || output.type !== ResponseType.ui_blocks) return null;
  if (!Array.isArray(output.blocks)) return null;
  const blocks = output.blocks.filter(isRenderable);
  return blocks.length > 0 ? blocks : null;
}

/** What a screen reader hears for a chart: each point with its label. */
export function getChartSummary(block: ChartBlock) {
  const unit = block.unit ? ` ${block.unit}` : "";
  const lines = block.series.map((series) => {
    const points = block.x_labels.map(
      (label, index) => `${label}: ${series.values[index]}${unit}`,
    );
    return `${series.name} — ${points.join(", ")}`;
  });
  const note = block.annotation
    ? [`Note at ${block.annotation.x}: ${block.annotation.label}`]
    : [];
  return [block.title ?? "Chart", ...lines, ...note].join(". ");
}

export function getChartData(block: ChartBlock) {
  return block.x_labels.map((label, pointIndex) => ({
    label,
    ...Object.fromEntries(
      block.series.map((series, seriesIndex) => [
        `series${seriesIndex}`,
        series.values[pointIndex],
      ]),
    ),
  }));
}

// A number, money or a percentage, optionally signed: "1,240", "$3.5k", "-12%".
const NUMERIC_CELL = /^[-+]?[$€£]?\d[\d,.]*\s?(%|[kKmMbB])?$/;

/** Columns whose every cell is a number, so they line up on the right. */
export function getNumericColumns(block: TableBlock) {
  return block.columns.map((_column, index) =>
    block.rows.every((row) => NUMERIC_CELL.test((row[index] ?? "").trim())),
  );
}
