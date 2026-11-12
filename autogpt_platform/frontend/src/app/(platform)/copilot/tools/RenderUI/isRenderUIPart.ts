import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";

export type RenderUIMessagePart =
  | (ToolUIPart & {
      type: "tool-render_ui" | "tool-render_openui" | "tool-run_capability";
    })
  | (DynamicToolUIPart & {
      toolName: "render_ui" | "render_openui" | "run_capability";
    });

export function isRenderUIPart(
  part: UIMessage["parts"][number],
): part is RenderUIMessagePart {
  const name =
    part.type === "dynamic-tool"
      ? part.toolName
      : part.type.replace(/^tool-/, "");
  if (name === "render_ui" || name === "render_openui") return true;
  if (name !== "run_capability" || !("input" in part)) return false;
  const input = part.input;
  return Boolean(
    input &&
      typeof input === "object" &&
      "id" in input &&
      (input.id === "tool:render_ui" || input.id === "tool:render_openui"),
  );
}
