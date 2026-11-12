"use client";

import type { ToolUIPart } from "ai";
import { asObject } from "../../components/ToolChain/resultHelpers";
import { getStreamingSource, readUIError, readUIResult } from "./helpers";
import { isRenderUIPart, type RenderUIMessagePart } from "./isRenderUIPart";
import dynamic from "next/dynamic";

const OpenUIView = dynamic(() =>
  import("./OpenUIView").then((module) => module.OpenUIView),
);
import { VisualCards } from "./VisualCards";

interface Props {
  part: ToolUIPart | RenderUIMessagePart;
  readOnly?: boolean;
  canAct?: boolean;
  isCurrentlyStreaming?: boolean;
  fileUrlBuilder?: (fileId: string) => string;
}

export function RenderUI({
  part,
  readOnly = false,
  canAct = false,
  isCurrentlyStreaming = false,
  fileUrlBuilder,
}: Props) {
  if (isRenderUIPart(part)) {
    const { result } = readUIResult(part);
    const name = part.type === "dynamic-tool" ? part.toolName : part.type;
    if (
      name.endsWith("render_openui") ||
      asObject(part.input)?.id === "tool:render_openui" ||
      asObject(part.output)?.type === "ui_rendered" ||
      readUIError(part) ||
      getStreamingSource(part) ||
      result?.source
    ) {
      return (
        <OpenUIView
          part={part}
          readOnly={readOnly}
          isCurrentlyStreaming={isCurrentlyStreaming}
        />
      );
    }
  }
  return (
    <VisualCards
      part={part}
      canAct={canAct && !readOnly}
      isCurrentlyStreaming={isCurrentlyStreaming}
      fileUrlBuilder={fileUrlBuilder}
    />
  );
}
