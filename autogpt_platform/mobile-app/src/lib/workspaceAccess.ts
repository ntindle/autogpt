import CookieManager from "@preeternal/react-native-cookie-manager";
import { Platform } from "react-native";

import { ACCESS_LOGIN_ORIGIN, FRONTEND_URL } from "./env";

const listeners = new Set<() => void>();
let revision = 0;

export function requestWorkspaceAccess() {
  revision += 1;
  listeners.forEach((listener) => listener());
}

export function accessRevision() {
  return revision;
}

export function subscribeWorkspaceAccess(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isWorkspaceAccessURL(value: string) {
  try {
    const { origin, protocol } = new URL(value);
    return (
      protocol === "https:" &&
      (origin === new URL(FRONTEND_URL).origin ||
        origin === ACCESS_LOGIN_ORIGIN)
    );
  } catch {
    return false;
  }
}

export function withWorkspaceAccess(
  fetcher: typeof globalThis.fetch,
  notify = true,
): typeof globalThis.fetch {
  return async function fetchWithAccess(input, init) {
    const url =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
    if (
      !ACCESS_LOGIN_ORIGIN ||
      new URL(url).origin !== new URL(FRONTEND_URL).origin
    ) {
      return fetcher(input, init);
    }
    const cookies = await CookieManager.get(
      FRONTEND_URL,
      Platform.OS === "ios",
    );
    const accessCookie = cookies.CF_Authorization?.value;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const existing = (headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith("CF_Authorization="));
    if (accessCookie) existing.push(`CF_Authorization=${accessCookie}`);
    if (existing.length) headers.set("cookie", existing.join("; "));
    else headers.delete("cookie");
    const response = await fetcher(input, {
      ...init,
      headers,
      credentials: "omit",
    });
    if (
      notify &&
      response.url &&
      new URL(response.url).origin === ACCESS_LOGIN_ORIGIN
    ) {
      requestWorkspaceAccess();
      throw new Error("Verify access to your private workspace to continue.");
    }
    return response;
  };
}

export const workspaceFetch = withWorkspaceAccess(globalThis.fetch);

export async function checkWorkspaceAccess(signal?: AbortSignal) {
  const response = await withWorkspaceAccess(globalThis.fetch, false)(
    `${FRONTEND_URL}/api/auth/ok`,
    { signal },
  );
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    return false;
  const data: unknown = await response.json();
  return (
    typeof data === "object" &&
    data !== null &&
    "ok" in data &&
    data.ok === true
  );
}
