import { useListCopilotSkills } from "@/services/skills/scoped-queries";
import { okData } from "@/app/api/helpers";
import { useState } from "react";

export function useSkillsPanel() {
  const [newSkillName, setNewSkillName] = useState<string | null>(null);
  const query = useListCopilotSkills(undefined, {
    query: {
      select: (res) => okData(res) ?? [],
    },
  });

  return {
    skills: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    newSkillName,
    handleSkillUploaded: setNewSkillName,
  };
}
