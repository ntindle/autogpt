import CookieManager from "@preeternal/react-native-cookie-manager";
import {
  accessRevision,
  isWorkspaceAccessURL,
  subscribeWorkspaceAccess,
  withWorkspaceAccess,
} from "../workspaceAccess";

jest.mock("@/lib/env", () => ({
  FRONTEND_URL: "https://workspace.example.com",
  ACCESS_LOGIN_ORIGIN: "https://workspace.cloudflareaccess.com",
}));

const cookieGetter = jest.mocked(CookieManager.get);

beforeEach(() => {
  cookieGetter.mockReset();
  cookieGetter.mockResolvedValue({
    CF_Authorization: { name: "CF_Authorization", value: "fake-access" },
    other_account: { name: "other_account", value: "must-not-send" },
  });
});

test("adds only the Access cookie and preserves the explicit app session", async () => {
  const fetcher = jest
    .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
    .mockResolvedValue({
      ok: true,
      url: "https://workspace.example.com/api/auth/token",
    } as Response);
  await withWorkspaceAccess(fetcher)(
    "https://workspace.example.com/api/auth/token",
    {
      headers: {
        Cookie:
          "better-auth.session_token=fake-session; CF_Authorization=stale",
        Authorization: "Bearer fake-jwt",
      },
      method: "POST",
      body: "unchanged",
    },
  );
  const init = fetcher.mock.calls[0][1];
  const headers = new Headers(init?.headers);
  expect(headers.get("cookie")).toBe(
    "better-auth.session_token=fake-session; CF_Authorization=fake-access",
  );
  expect(headers.get("authorization")).toBe("Bearer fake-jwt");
  expect(init).toMatchObject({
    credentials: "omit",
    method: "POST",
    body: "unchanged",
  });
});

test.each([
  "https://other.example.com/api/chat",
  "https://workspace.example.com.evil.test/api/chat",
  "http://workspace.example.com/api/chat",
])("never attaches workspace cookies to %s", async (url) => {
  const fetcher = jest
    .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
    .mockResolvedValue({ ok: true } as Response);
  const init = { headers: { Accept: "application/json" } };
  await withWorkspaceAccess(fetcher)(url, init);
  expect(cookieGetter).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledWith(url, init);
});

test("requests verification after expiry and does not treat it as app sign-out", async () => {
  const listener = jest.fn();
  const unsubscribe = subscribeWorkspaceAccess(listener);
  const before = accessRevision();
  const fetcher = jest
    .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
    .mockResolvedValue({
      url: "https://workspace.cloudflareaccess.com/cdn-cgi/access/login",
    } as Response);
  try {
    await expect(
      withWorkspaceAccess(fetcher)(
        "https://workspace.example.com/_agpt/api/home",
      ),
    ).rejects.toThrow("Verify access");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(accessRevision()).toBe(before + 1);
    await withWorkspaceAccess(
      fetcher,
      false,
    )("https://workspace.example.com/api/auth/ok");
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
});

test("keeps native verification navigation on the configured HTTPS origins", () => {
  expect(
    isWorkspaceAccessURL(
      "https://workspace.cloudflareaccess.com/cdn-cgi/access/login",
    ),
  ).toBe(true);
  expect(
    isWorkspaceAccessURL("https://workspace.example.com/api/auth/ok"),
  ).toBe(true);
  expect(isWorkspaceAccessURL("https://workspace.example.com.evil.test")).toBe(
    false,
  );
  expect(isWorkspaceAccessURL("http://workspace.example.com/api/auth/ok")).toBe(
    false,
  );
  expect(isWorkspaceAccessURL("javascript:alert(1)")).toBe(false);
});
