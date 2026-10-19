import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerChatSender,
  chatHref,
  SEND_TO_CHAT_TIMEOUT_MS,
  sendToChat,
} from "../sendToChat";

vi.mock("@/components/molecules/Toast/use-toast", () => ({ toast: vi.fn() }));

describe("sendToChat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("settles a queued message once the chat takes it", async () => {
    const sent = sendToChat("chat-a", "hello");
    const settled = vi.fn();
    void sent.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    const sender = vi.fn().mockResolvedValue(undefined);
    const unregister = registerChatSender("chat-a", sender);
    await expect(sent).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledWith("hello");
    unregister();
  });

  it("rejects a queued message the chat fails to send", async () => {
    const sent = sendToChat("chat-b", "hello");
    const unregister = registerChatSender("chat-b", () => {
      throw new Error("offline");
    });
    await expect(sent).rejects.toThrow("offline");
    unregister();
  });

  it("rejects and drops a queued message when the chat never opens", async () => {
    const sent = sendToChat("chat-c", "hello");
    const rejected = expect(sent).rejects.toThrow(/in time/);
    vi.advanceTimersByTime(SEND_TO_CHAT_TIMEOUT_MS);
    await rejected;

    const sender = vi.fn();
    const unregister = registerChatSender("chat-c", sender);
    expect(sender).not.toHaveBeenCalled();
    unregister();
  });

  it("sends straight away when the chat is already registered", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const unregister = registerChatSender("chat-d", sender);
    await expect(sendToChat("chat-d", "hi")).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledWith("hi");
    unregister();
  });

  it("keeps queued submissions private to their owner and saved organization", async () => {
    const saved = { ownerId: "owner-a", organizationId: "org-a", teamId: null };
    const sent = sendToChat("shared-session-id", "private form", saved);
    const wrongOrg = vi.fn();
    const wrongOwner = vi.fn();
    const stopOrg = registerChatSender("shared-session-id", wrongOrg, {
      ...saved,
      organizationId: "org-b",
    });
    const stopOwner = registerChatSender("shared-session-id", wrongOwner, {
      ...saved,
      ownerId: "owner-b",
    });
    expect(wrongOrg).not.toHaveBeenCalled();
    expect(wrongOwner).not.toHaveBeenCalled();
    const sender = vi.fn();
    const stopSaved = registerChatSender("shared-session-id", sender, saved);
    await expect(sent).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledWith("private form");
    stopOrg();
    stopOwner();
    stopSaved();
  });

  it("pins navigation including explicit personal scope", () => {
    const saved = new URL(
      chatHref("chat-a", { organizationId: "org-a", teamId: "team-a" }),
      "http://localhost",
    );
    expect(saved.searchParams.get("organizationId")).toBe("org-a");
    expect(saved.searchParams.get("teamId")).toBe("team-a");
    const personal = new URL(
      chatHref("chat-a", { organizationId: null }),
      "http://localhost",
    );
    expect(personal.searchParams.get("organizationId")).toBe("__personal__");
    expect(personal.searchParams.get("teamId")).toBe("__org_home__");
  });
});
