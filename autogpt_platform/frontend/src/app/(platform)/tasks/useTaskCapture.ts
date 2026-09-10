import { useCreateWorkspaceTask } from "@/app/api/__generated__/endpoints/tasks/tasks";
import { useRef, useState } from "react";

interface Entry {
  id: string;
  title: string;
}
interface Options {
  project: string;
  refresh: () => Promise<void>;
  report: (error: unknown) => void;
}

export function useTaskCapture({ project, refresh, report }: Options) {
  const create = useCreateWorkspaceTask();
  const [draft, setDraft] = useState("");
  const [addParent, setAddParent] = useState<string | null>(null);
  const queue = useRef<{
    entries: Entry[];
    parent: string | null;
    project: string;
  } | null>(null);
  const capturing = useRef(false);

  async function capture() {
    if (capturing.current) return;
    const titles = draft
      .split("\n")
      .map((title) => title.replace(/^\s*(?:[-*] |\d+[.)] )/, "").trim())
      .filter(Boolean);
    if (!titles.length) return;
    if (
      !queue.current ||
      queue.current.parent !== addParent ||
      queue.current.project !== project ||
      queue.current.entries.map((entry) => entry.title).join("\n") !==
        titles.join("\n")
    ) {
      queue.current = {
        entries: titles.map((title) => ({ id: crypto.randomUUID(), title })),
        parent: addParent,
        project,
      };
    }
    capturing.current = true;
    const batch = queue.current;
    try {
      while (batch.entries.length) {
        const response = await create.mutateAsync({
          data: {
            ...batch.entries[0],
            parent_id: batch.parent,
            project: batch.project,
          },
        });
        if (response.status !== 201) throw new Error("Could not save the task");
        batch.entries.shift();
      }
      setAddParent(null);
    } catch (error) {
      report(error);
    } finally {
      setDraft(batch.entries.map((entry) => entry.title).join("\n"));
      capturing.current = false;
      await refresh();
    }
  }

  return {
    draft,
    setDraft,
    addParent,
    setAddParent,
    capture,
    isCapturing: create.isPending,
  };
}
