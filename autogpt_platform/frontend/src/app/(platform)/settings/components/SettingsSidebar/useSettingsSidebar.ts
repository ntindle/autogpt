import { usePathname } from "next/navigation";
import { useIsBillingEnabled } from "@/hooks/useIsBillingEnabled";
import { Flag, useGetFlag } from "@/services/feature-flags/use-get-flag";
import { settingsNavItems } from "./helpers";

export function useSettingsSidebar() {
  const pathname = usePathname();
  const isMemoryEnabled = useGetFlag(Flag.GRAPHITI_MEMORY);
  const isOrgSettingsEnabled = useGetFlag(Flag.SHOW_ORG_SETTINGS);
  const isSkillLearningEnabled = useGetFlag(Flag.DREAM_SKILL_LEARNING_ENABLED);
  const isBillingEnabled = useIsBillingEnabled();

  const items = settingsNavItems
    .filter(
      (item) =>
        item.flag !== Flag.GRAPHITI_MEMORY ||
        isMemoryEnabled ||
        isSkillLearningEnabled,
    )
    .filter((item) => item.href !== "/settings/billing" || isBillingEnabled)
    .filter(
      (item) => item.flag !== Flag.SHOW_ORG_SETTINGS || isOrgSettingsEnabled,
    )
    .map((item) => ({
      ...item,
      isActive:
        pathname === item.href ||
        (item.href !== "/settings" && pathname.startsWith(`${item.href}/`)),
    }));

  return { items };
}
