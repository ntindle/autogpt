import { useState } from "react";
import { useListWorkspaceFiles } from "@/app/api/__generated__/endpoints/workspace/workspace";
import { okData } from "@/app/api/helpers";
import type { ArtifactRef } from "../../copilot/store";
import {
  extractWorkspaceArtifacts,
  resolveWorkspaceUrls,
  WORKSPACE_FILE_PATTERN,
} from "../../copilot/components/ChatMessagesContainer/helpers";
import { fileItemToArtifactRef } from "../../copilot/components/ContextPanel/components/FilesTab/helpers";

import {
  ExternalLinkModal,
  isSameOriginLink,
  MessageResponse,
} from "@/components/ai-elements/message";
import { TaskResultPreview } from "./TaskResultPreview";

interface Props {
  result: string;
  sessionId?: string | null;
}

export function TaskResultContent({ result, sessionId }: Props) {
  const [selected, setSelected] = useState<ArtifactRef | null>(null);
  const files = useListWorkspaceFiles(
    { session_id: sessionId, limit: 1000 },
    { query: { enabled: Boolean(sessionId), select: okData } },
  );
  const artifacts = new Map(
    extractWorkspaceArtifacts(result).map((artifact) => [
      artifact.id,
      artifact,
    ]),
  );
  const names = new Map<string, number>();
  for (const item of files.data?.files ?? [])
    names.set(item.name, (names.get(item.name) ?? 0) + 1);
  for (const item of files.data?.files ?? []) {
    const referenced =
      artifacts.has(item.id) ||
      result.includes(item.path) ||
      (names.get(item.name) === 1 && result.includes(item.name));
    if (referenced) artifacts.set(item.id, fileItemToArtifactRef(item));
  }
  function fileForUrl(url: string) {
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin !== window.location.origin) return null;
      const id = parsed.pathname.match(WORKSPACE_FILE_PATTERN)?.[1];
      return id ? (artifacts.get(id) ?? null) : null;
    } catch {
      return null;
    }
  }

  return (
    <>
      <div className="min-w-0 break-words text-sm">
        <MessageResponse
          linkSafety={{
            enabled: true,
            onLinkCheck: (url) => !fileForUrl(url) && isSameOriginLink(url),
            renderModal: (props) => {
              const file = fileForUrl(props.url);
              return file ? (
                <TaskResultPreview
                  artifact={props.isOpen ? file : null}
                  onClose={props.onClose}
                />
              ) : (
                <ExternalLinkModal {...props} />
              );
            },
          }}
        >
          {resolveWorkspaceUrls(result)}
        </MessageResponse>
      </div>
      {(artifacts.size > 0 || files.isError) && (
        <section className="space-y-2" aria-label="Deliverable files">
          <h4 className="text-xs font-medium text-muted-foreground">
            Deliverable files
          </h4>
          {files.isError ? (
            <p className="text-xs text-muted-foreground">
              Could not load files referenced by name.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => files.refetch()}
              >
                Try again
              </button>
            </p>
          ) : null}
          {[...artifacts.values()].map((artifact) => (
            <div
              key={artifact.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
            >
              <button
                type="button"
                className="min-h-11 min-w-0 break-all text-left text-sm font-medium underline underline-offset-4"
                onClick={() => setSelected(artifact)}
              >
                {artifact.title}
              </button>
              <a
                href={artifact.sourceUrl ?? undefined}
                className="flex min-h-11 items-center text-xs underline"
                download
              >
                Download
              </a>
            </div>
          ))}
        </section>
      )}
      <TaskResultPreview
        artifact={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
