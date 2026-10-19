import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePostV2SaveUiDraftToFile } from "@/app/api/__generated__/endpoints/chat/chat";
import { getListWorkspaceFilesQueryKey } from "@/app/api/__generated__/endpoints/workspace/workspace";
import { invalidateWorkspaceFileQueries } from "@/app/(platform)/artifacts/components/ArtifactsList/helpers";
import { validateFileName } from "@/app/(platform)/artifacts/components/RenameFileDialog/helpers";
import { ApiError } from "@/lib/autogpt-server-api/helpers";
import { defaultViewFileName } from "@/lib/openui/file";
import type { SavedFileRef } from "../../helpers";
import { useOpenUIScope } from "../../OpenUIScopeContext";
import { openUIRequest } from "../../scope";

interface Args {
  ownerId: string | undefined;
  sessionId: string;
  viewId: string;
  title: string;
  beforeSave: () => Promise<void>;
  onSaved: (file: SavedFileRef) => void;
}

export function useSaveViewDialog(args: Args) {
  const queryClient = useQueryClient();
  const scope = useOpenUIScope();
  const [name, setName] = useState(defaultViewFileName(args.title));
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const submitting = useRef(false);
  const { mutateAsync } = usePostV2SaveUiDraftToFile({
    request: openUIRequest(scope),
  });
  const trimmed = name.trim();
  const validationError = validateFileName(trimmed);

  async function handleSubmit() {
    if (validationError || submitting.current) return;
    submitting.current = true;
    setIsPending(true);
    setError(null);
    try {
      await args.beforeSave();
      const result = await mutateAsync({
        sessionId: args.sessionId,
        viewId: args.viewId,
        data: { filename: trimmed },
      });
      if (result.status !== 200) throw new Error("save");
      void queryClient.invalidateQueries({
        queryKey: ["ui-draft", args.ownerId, args.sessionId, args.viewId],
      });
      void queryClient.invalidateQueries({
        queryKey: getListWorkspaceFilesQueryKey(),
      });
      invalidateWorkspaceFileQueries(queryClient);
      args.onSaved({ id: result.data.file_id, name: result.data.file_name });
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "A file with this name already exists. Choose another name."
          : "The view couldn't be saved. Try again.",
      );
    } finally {
      submitting.current = false;
      setIsPending(false);
    }
  }

  return {
    name,
    setName,
    error: validationError ?? error,
    canSubmit: !validationError && !isPending,
    isPending,
    handleSubmit,
  };
}
