import { API_URL } from "@/lib/env";
import {
  assertSameSession,
  clearAccessToken,
  getAccessToken,
  sessionMark,
} from "@/lib/auth/token";
import { workspaceFetch } from "@/lib/workspaceAccess";
import { resourceHeaders, type ResourceScope } from "./resourceScope";

export class ApiError extends Error {
  status: number;
  /** The `code` a `{ code, message }` detail carries, e.g. MCP's "no_oauth". */
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export async function authHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}` };
}

export function apiUrl(path: string, query?: RequestOptions["query"]) {
  const params = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return `${API_URL}${path}${params.length ? `?${params.join("&")}` : ""}`;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
) {
  const mark = sessionMark();
  options = {
    ...options,
    headers: {
      ...(await requestScopeHeaders(path, options.query)),
      ...options.headers,
    },
  };
  assertSameSession(mark);
  let response = await send(path, options);
  if (response.status === 401) {
    // Never replay a request for an account that signed in after it started.
    assertSameSession(mark);
    clearAccessToken();
    response = await send(path, options);
    // A second 401 reads as a dead session; only if it is still this one.
    assertSameSession(mark);
  }
  if (!response.ok) {
    const { message, code } = await readError(response);
    // Reading the body can outlast the session; a stale 401 must not reach
    // a handler that signs out whoever signed in meanwhile.
    assertSameSession(mark);
    throw new ApiError(response.status, message, code);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function sessionScopeHeaders(sessionID: string) {
  const scope = await apiRequest<ResourceScope>(
    `/api/tasks/conversation/${encodeURIComponent(sessionID)}/scope`,
  );
  return resourceHeaders(scope);
}

export async function expertScopeHeaders(expertID: string) {
  const scope = await apiRequest<ResourceScope>(
    `/api/experts/${encodeURIComponent(expertID)}`,
  );
  return resourceHeaders(scope);
}

async function requestScopeHeaders(
  path: string,
  query?: RequestOptions["query"],
) {
  const sessionID = path.match(/^\/api\/chat\/sessions\/([^/]+)(?:\/|$)/)?.[1];
  if (sessionID) return sessionScopeHeaders(decodeURIComponent(sessionID));
  if (typeof query?.session_id === "string")
    return sessionScopeHeaders(query.session_id);
  if (path === "/api/workspace/files" && typeof query?.expert_id === "string")
    return expertScopeHeaders(query.expert_id);
  return {};
}

async function send(
  path: string,
  { method = "GET", body, query, headers }: RequestOptions,
) {
  return workspaceFetch(apiUrl(path, query), {
    method,
    headers: {
      ...(await authHeaders()),
      ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readError(response: Response) {
  const fallback = {
    message: `Request failed (${response.status})`,
    code: null,
  };
  try {
    const data = (await response.json()) as { detail?: unknown };
    if (typeof data.detail === "string")
      return { message: data.detail, code: null };
    if (data.detail && typeof data.detail === "object") {
      const { message, code } = data.detail as {
        message?: unknown;
        code?: unknown;
      };
      return {
        message: typeof message === "string" ? message : fallback.message,
        code: typeof code === "string" ? code : null,
      };
    }
  } catch {
    // Not JSON: fall through to the status line.
  }
  return fallback;
}
