import dynamic from "next/dynamic";
import { Dialog } from "@/components/molecules/Dialog/Dialog";
import { Button } from "@/components/atoms/Button/Button";
import type { ArtifactRef } from "../../copilot/store";
import { classifyArtifact } from "../../copilot/components/ArtifactPanel/helpers";

const ArtifactContent = dynamic(() =>
  import(
    "../../copilot/components/ArtifactPanel/components/ArtifactContent"
  ).then((module) => module.ArtifactContent),
);

interface Props {
  artifact: ArtifactRef | null;
  onClose: () => void;
}

export function TaskResultPreview({ artifact, onClose }: Props) {
  if (!artifact) return null;
  const classification = classifyArtifact(
    artifact.mimeType,
    artifact.title,
    artifact.sizeBytes,
  );
  return (
    <Dialog
      title={artifact.title}
      controlled={{
        isOpen: true,
        set: (open) => {
          if (!open) onClose();
        },
      }}
    >
      <Dialog.Content>
        <div className="flex h-[65dvh] min-h-0 min-w-0 flex-col">
          <ArtifactContent
            artifact={artifact}
            classification={classification}
            isSourceView={false}
          />
        </div>
        <Dialog.Footer>
          <Button variant="secondary" onClick={onClose}>
            Back to review
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
