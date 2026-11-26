"use client";

import { useDeleteV2DeleteAPreset } from "@/app/api/__generated__/endpoints/presets/presets";
import type { LibraryAgent } from "@/app/api/__generated__/models/libraryAgent";
import { Button } from "@/components/atoms/Button/Button";
import { LoadingSpinner } from "@/components/atoms/LoadingSpinner/LoadingSpinner";
import { Text } from "@/components/atoms/Text/Text";
import { Dialog } from "@/components/molecules/Dialog/Dialog";
import { useToast } from "@/components/molecules/Toast/use-toast";
import { getTenantRequestInit } from "@/components/contextual/TeamPicker/helpers";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { refetchPresets } from "../../../../helpers";
import { AgentActionsDropdown } from "../../AgentActionsDropdown";
import { Delete02Icon, FloppyDiskIcon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/atoms/Icon/Icon";

interface Props {
  agent: LibraryAgent;
  triggerId: string;
  onDeleted?: () => void;
  onSaveChanges?: () => void;
  isSaving?: boolean;
}

export function SelectedTriggerActions({
  agent,
  triggerId,
  onDeleted,
  onSaveChanges,
  isSaving,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const organizationId = agent.organization_id ?? null;
  const teamId = agent.team_id ?? null;

  const deleteMutation = useDeleteV2DeleteAPreset({
    request: getTenantRequestInit(organizationId, teamId),
    mutation: {
      onSuccess: async () => {
        toast({
          title: "Trigger deleted",
        });
        await refetchPresets({
          queryClient,
          graphID: agent.graph_id,
          organizationId,
          teamId,
        });

        setShowDeleteDialog(false);
        // The sidebar then selects the next trigger, or the page leaves the
        // emptied Triggers tab, which also lists trigger workflows.
        onDeleted?.();
      },
      onError: (error: any) => {
        toast({
          title: "Failed to delete trigger",
          description: error.message || "An unexpected error occurred.",
          variant: "destructive",
        });
      },
    },
  });

  function handleDelete() {
    deleteMutation.mutate({ presetId: triggerId });
  }

  return (
    <>
      <div className="my-4 flex flex-col items-center gap-3">
        <Button
          variant="icon"
          size="icon"
          aria-label="Save changes"
          onClick={onSaveChanges}
          disabled={isSaving || deleteMutation.isPending}
        >
          {isSaving ? (
            <LoadingSpinner size="small" />
          ) : (
            <Icon icon={FloppyDiskIcon} size={18} />
          )}
        </Button>
        <Button
          variant="icon"
          size="icon"
          aria-label="Delete trigger"
          onClick={() => setShowDeleteDialog(true)}
          disabled={isSaving || deleteMutation.isPending}
        >
          {deleteMutation.isPending ? (
            <LoadingSpinner size="small" />
          ) : (
            <Icon icon={Delete02Icon} size={18} />
          )}
        </Button>
        <AgentActionsDropdown agent={agent} />
      </div>

      <Dialog
        controlled={{
          isOpen: showDeleteDialog,
          set: setShowDeleteDialog,
        }}
        styling={{ maxWidth: "32rem" }}
        title="Delete trigger"
      >
        <Dialog.Content>
          <Text variant="large">
            Are you sure you want to delete this trigger? This action cannot be
            undone.
          </Text>
          <Dialog.Footer>
            <Button
              variant="secondary"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              loading={deleteMutation.isPending}
            >
              Delete
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </>
  );
}
