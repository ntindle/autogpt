"use client";

import { OpenUI } from "@/components/organisms/OpenUI/OpenUI";
import { parseAsString, useQueryState } from "nuqs";
import type { ArtifactRef } from "../../../store";
import { CopilotChatActionsProvider } from "../../CopilotChatActionsProvider/CopilotChatActionsProvider";
import { OpenUIFileView } from "../../OpenUIFileView/OpenUIFileView";
import { readViewMeta } from "../../../tools/RenderUI/helpers";
import { OpenUIScopeProvider } from "../../../tools/RenderUI/OpenUIScopeContext";
import { useCopilotTenantScope } from "../../../CopilotTenantScopeContext";

interface Props {
  artifact: ArtifactRef;
  content: string;
  readOnly: boolean;
}

export function OpenUIArtifact({ artifact, content, readOnly }: Props) {
  const [sessionId] = useQueryState("sessionId", parseAsString);
  const tenantScope = useCopilotTenantScope();
  const hasSavedScope = "organizationId" in artifact || "teamId" in artifact;
  const source = (
    <pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm text-zinc-800">
      {content}
    </pre>
  );
  if (readOnly) {
    if (!readViewMeta(content).valid) return source;
    return (
      <div className="p-4">
        <CopilotChatActionsProvider onSend={() => {}} chatSurface="share">
          <OpenUI
            source={content}
            isStreaming={false}
            disabled
            revision={0}
            onAction={() => {}}
            fallback={source}
          />
        </CopilotChatActionsProvider>
      </div>
    );
  }
  return (
    <OpenUIScopeProvider
      organizationId={
        hasSavedScope
          ? (artifact.organizationId ?? null)
          : tenantScope.organizationId
      }
      teamId={hasSavedScope ? (artifact.teamId ?? null) : tenantScope.teamId}
    >
      <div className="px-4">
        <OpenUIFileView
          key={artifact.id}
          fileId={artifact.id}
          currentSessionId={sessionId}
          fallback={source}
        />
      </div>
    </OpenUIScopeProvider>
  );
}
