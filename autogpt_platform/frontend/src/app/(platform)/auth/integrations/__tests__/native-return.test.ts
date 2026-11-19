// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { redirectToNativeApp } from "../native-return";

afterEach(() => vi.unstubAllEnvs());

it.each([
  { code: "fixture-code", error: null, key: "code", value: "fixture-code" },
  { code: null, error: "access_denied", key: "error", value: "access_denied" },
])("returns $key to the configured personal app", ({ code, error, key, value }) => {
  vi.stubEnv("AUTH_MOBILE_APP_SCHEME", "ntindle-autogpt");
  const response = redirectToNativeApp({
    state: "native.fixture-state",
    code,
    error,
    errorDescription: null,
  });
  const location = new URL(response.headers.get("location")!);
  expect(location.protocol).toBe("ntindle-autogpt:");
  expect(location.host).toBe("integrations");
  expect(location.pathname).toBe("/oauth");
  expect(location.searchParams.get(key)).toBe(value);
  expect(location.searchParams.get("state")).toBe("native.fixture-state");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});

it("preserves the standard return scheme without a configured personal app", () => {
  vi.stubEnv("AUTH_MOBILE_APP_SCHEME", "");
  const response = redirectToNativeApp({
    state: "native.fixture-state",
    code: "fixture-code",
    error: null,
    errorDescription: null,
  });
  expect(new URL(response.headers.get("location")!).protocol).toBe("autogpt-app:");
});
