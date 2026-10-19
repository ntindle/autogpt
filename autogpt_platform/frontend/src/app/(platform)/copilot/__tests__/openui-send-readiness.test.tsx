import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CopilotChatHost } from "../CopilotChatHost";
import { sendToChat } from "../helpers/sendToChat";
import { OpenUIScopeProvider } from "../tools/RenderUI/OpenUIScopeContext";

const chat = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  send: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../useCopilotPage", () => ({
  useCopilotPage: () => ({ ...chat.state, onSend: chat.send }),
}));
vi.mock("../components/ChatContainer/ChatContainer", () => ({
  ChatContainer: () => null,
}));
vi.mock("../components/ProviderLimitDialog/ProviderLimitDialog", () => ({
  ProviderLimitDialog: () => null,
}));
vi.mock("../components/RateLimitResetDialog/RateLimitGate", () => ({
  RateLimitGate: () => null,
}));
vi.mock("../components/RateLimitResetDialog/useRateLimitRefresh", () => ({
  useRateLimitRefresh: () => ({ guarded: false }),
}));
vi.mock("@/services/usageExperience/useUsageExperience", () => ({
  useUsageExperience: () => ({ retry: vi.fn() }),
}));
vi.mock("@/services/feature-flags/use-get-flag", () => ({
  Flag: { COPILOT_STREAM_RUNTIME: "stream" },
  useGetFlag: () => false,
}));

function host() {
  return (
    <OpenUIScopeProvider organizationId="saved-a" teamId={null}>
      <CopilotChatHost droppedFiles={[]} onDroppedFilesConsumed={() => {}} />
    </OpenUIScopeProvider>
  );
}

describe("OpenUI submission waits for a usable chat", () => {
  it.each([
    { isResolvingExpertIdentity: true },
    { isSessionError: true },
    { isSessionNotFound: true },
    { isAdoptingExpertSession: true },
    { isKickoffStarting: true },
    { expertIdentity: { isArchived: true } },
  ])("does not drain a queued form while %j", async (blocked) => {
    chat.send.mockClear();
    chat.state = { sessionId: "saved-chat", ...blocked };
    const pending = sendToChat("saved-chat", "Private form", {
      organizationId: "saved-a",
      teamId: null,
    });
    const ui = render(host());
    expect(chat.send).not.toHaveBeenCalled();
    chat.state = { sessionId: "saved-chat" };
    ui.rerender(host());
    await pending;
    expect(chat.send).toHaveBeenCalledExactlyOnceWith("Private form");
  });
});
