import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useCopilotUIStore } from "@/app/(platform)/copilot/store";
import { useOrgTeamStore } from "../store";
import { useOrganizationNavigation } from "../useOrganizationNavigation";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

test("switching from a chat clears composer identity and opens the new org home", () => {
  useOrgTeamStore.setState({
    activeOrgID: "autogpt",
    activeTeamID: "old-team",
  });
  useCopilotUIStore.setState({
    initialPrompt: "Private AutoGPT draft",
    copilotLlmAuth: { authProvider: "codex", credentialId: "autogpt-private" },
  });
  const { result } = renderHook(useOrganizationNavigation);
  act(() => result.current.openOrganization("denton"));
  expect(replace).toHaveBeenCalledWith("/home");
  expect(useOrgTeamStore.getState().activeOrgID).toBe("denton");
  expect(useOrgTeamStore.getState().activeTeamID).toBeNull();
  expect(useCopilotUIStore.getState().initialPrompt).toBeNull();
  expect(useCopilotUIStore.getState().copilotLlmAuth).toBeNull();
});
