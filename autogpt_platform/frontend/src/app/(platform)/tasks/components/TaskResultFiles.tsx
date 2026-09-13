import { useState } from "react";
import dynamic from "next/dynamic";
import { useListWorkspaceFiles } from "@/app/api/__generated__/endpoints/workspace/workspace";
import { okData } from "@/app/api/helpers";
import { Dialog } from "@/components/molecules/Dialog/Dialog";
import { Button } from "@/components/atoms/Button/Button";
import type { ArtifactRef } from "../../copilot/store";
import { extractWorkspaceArtifacts } from "../../copilot/components/ChatMessagesContainer/helpers";
import { classifyArtifact } from "../../copilot/components/ArtifactPanel/helpers";
import { fileItemToArtifactRef } from "../../copilot/components/ContextPanel/components/FilesTab/helpers";

const ArtifactContent = dynamic(() =>
  import(
    "../../copilot/components/ArtifactPanel/components/ArtifactContent"
  ).then((module) => module.ArtifactContent),
);

interface Props {
  result: string;
  sessionId?: string | null;
}

export function TaskResultFiles({ result, sessionId }: Props) {
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
  const classification = selected
    ? classifyArtifact(selected.mimeType, selected.title, selected.sizeBytes)
    : null;
  if (!artifacts.size && !files.isError) return null;
  return (
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
      <Dialog
        title={selected?.title ?? "Deliverable preview"}
        controlled={{
          isOpen: Boolean(selected),
          set: (open) => {
            if (!open) setSelected(null);
          },
        }}
      >
        <Dialog.Content>
          <div className="flex h-[65dvh] min-h-0 flex-col">
            {selected && classification ? (
              <ArtifactContent
                artifact={selected}
                classification={classification}
                isSourceView={false}
              />
            ) : null}
          </div>
          <Dialog.Footer>
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Back to review
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </section>
  );
}
