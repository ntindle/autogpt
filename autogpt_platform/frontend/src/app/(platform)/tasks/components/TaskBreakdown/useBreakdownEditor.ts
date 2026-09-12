import { useState } from "react";
import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import type { TaskBreakdown } from "@/app/api/__generated__/models/taskBreakdown";

export function useBreakdownEditor(preview: TaskBreakdown) {
  const [shownPreview, setShownPreview] = useState(preview);
  const [steps, setSteps] = useState(() => previewSteps(preview));
  const hasUpdate = shownPreview.id !== preview.id;

  function reviewUpdate() {
    setShownPreview(preview);
    setSteps(previewSteps(preview));
  }

  function edit(
    id: string,
    values: { title?: string; assignee?: TaskAssignee | null },
  ) {
    setSteps((current) =>
      current.map((step) => (step.id === id ? { ...step, ...values } : step)),
    );
  }

  function toggle(id: string, selected: boolean) {
    setSteps((current) => {
      const changed = new Set([id]);
      for (let pass = 0; pass < current.length; pass++) {
        for (const step of current) {
          if (selected && changed.has(step.id))
            step.dependencies?.forEach((dependency) => changed.add(dependency));
          if (
            !selected &&
            step.dependencies?.some((dependency) => changed.has(dependency))
          )
            changed.add(step.id);
        }
      }
      return current.map((step) =>
        changed.has(step.id) ? { ...step, selected } : step,
      );
    });
  }

  const selected = steps.filter((step) => step.selected);
  return {
    steps,
    selected,
    edit,
    toggle,
    hasUpdate,
    reviewUpdate,
    previewID: shownPreview.id,
  };
}

function previewSteps(preview: TaskBreakdown) {
  return (preview.steps ?? []).map((step) => ({
    ...step,
    id: step.id!,
    selected: true,
    assignee: step.suggestion ?? null,
  }));
}
