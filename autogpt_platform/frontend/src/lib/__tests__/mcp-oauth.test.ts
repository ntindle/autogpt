import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOrgTeamStore } from "@/services/org-team/store";
import { connectMCPOAuth } from "../mcp-oauth";
import type { CredentialsMetaResponse } from "@/app/api/__generated__/models/credentialsMetaResponse";
import { openOAuthPopup, preOpenOAuthPopup } from "../oauth-popup";
import {
  postV2InitiateOauthLoginForAnMcpServer,
  postV2ExchangeOauthCodeForMcpTokens,
} from "@/app/api/__generated__/endpoints/mcp/mcp";

vi.mock("@/app/api/__generated__/endpoints/mcp/mcp", () => ({
  postV2InitiateOauthLoginForAnMcpServer: vi.fn(),
  postV2ExchangeOauthCodeForMcpTokens: vi.fn(),
}));
vi.mock("../oauth-popup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../oauth-popup")>()),
  preOpenOAuthPopup: vi.fn(),
  openOAuthPopup: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const login = {
  status: 200 as const,
  data: { login_url: "https://login.example.com", state_token: "state" },
  headers: new Headers(),
};

describe("MCP OAuth attempt ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("closes a canceled initiation and ignores its late response", async () => {
    const pending = deferred<typeof login>();
    const popup = { closed: false, close: vi.fn() };
    vi.mocked(preOpenOAuthPopup).mockReturnValue(popup as unknown as Window);
    vi.mocked(postV2InitiateOauthLoginForAnMcpServer).mockReturnValue(
      pending.promise,
    );
    const controller = new AbortController();
    const result = connectMCPOAuth({
      serverURL: "https://mcp.example.com",
      signal: controller.signal,
    });
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });

    controller.abort();
    expect(popup.close).toHaveBeenCalledOnce();
    pending.resolve(login);
    await rejected;

    expect(openOAuthPopup).not.toHaveBeenCalled();
    expect(postV2ExchangeOauthCodeForMcpTokens).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it("does not reopen a blank window the user already closed", async () => {
    const pending = deferred<typeof login>();
    const popup = { closed: false, close: vi.fn() };
    vi.mocked(preOpenOAuthPopup).mockReturnValue(popup as unknown as Window);
    vi.mocked(postV2InitiateOauthLoginForAnMcpServer).mockReturnValue(
      pending.promise,
    );
    const result = connectMCPOAuth({
      serverURL: "https://mcp.example.com",
      signal: new AbortController().signal,
    });
    const rejected = expect(result).rejects.toThrow(
      "Sign-in window was closed",
    );
    popup.closed = true;
    pending.resolve(login);
    await rejected;
    expect(openOAuthPopup).not.toHaveBeenCalled();
  });

  it("rejects a late exchange result after cancellation", async () => {
    const pending = deferred<CredentialsMetaResponse>();
    const exchange = vi.fn(() => pending.promise);
    vi.mocked(postV2InitiateOauthLoginForAnMcpServer).mockResolvedValue(login);
    vi.mocked(preOpenOAuthPopup).mockReturnValue(null);
    vi.mocked(openOAuthPopup).mockReturnValue({
      promise: Promise.resolve({ code: "code", state: "state" }),
      cleanup: { abort: vi.fn(), signal: new AbortController().signal },
      popupBlocked: false,
      fallbackBlocked: false,
    });
    const controller = new AbortController();
    const result = connectMCPOAuth({
      serverURL: "https://mcp.example.com",
      signal: controller.signal,
      exchange,
    });
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledOnce());
    controller.abort();
    pending.resolve({
      id: "credential",
      provider: "mcp",
      type: "oauth2",
      title: null,
      scopes: null,
      username: null,
    });
    await rejected;
  });
});

it("pins OAuth exchange to the initiating organization after a switch", async () => {
  vi.resetAllMocks();
  useOrgTeamStore.setState({ activeOrgID: "org-a", activeTeamID: null });
  const pending = deferred<{ code: string; state: string }>();
  vi.mocked(preOpenOAuthPopup).mockReturnValue(null);
  vi.mocked(postV2InitiateOauthLoginForAnMcpServer).mockResolvedValue(login);
  vi.mocked(openOAuthPopup).mockReturnValue({
    promise: pending.promise,
    cleanup: { abort: vi.fn(), signal: new AbortController().signal },
    popupBlocked: false,
    fallbackBlocked: false,
  });
  vi.mocked(postV2ExchangeOauthCodeForMcpTokens).mockResolvedValue({
    status: 200,
    data: {
      id: "credential",
      provider: "mcp",
      type: "oauth2",
      title: null,
      scopes: null,
      username: null,
    },
    headers: new Headers(),
  });
  const result = connectMCPOAuth({
    serverURL: "https://mcp.example.com",
    signal: new AbortController().signal,
  });
  await vi.waitFor(() => expect(openOAuthPopup).toHaveBeenCalledOnce());
  useOrgTeamStore.setState({ activeOrgID: "org-b" });
  pending.resolve({ code: "code", state: "state" });
  await result;
  const request = vi.mocked(postV2ExchangeOauthCodeForMcpTokens).mock
    .calls[0][1];
  expect(new Headers(request?.headers).get("X-Org-Id")).toBe("org-a");
  useOrgTeamStore.setState({ activeOrgID: null });
});
