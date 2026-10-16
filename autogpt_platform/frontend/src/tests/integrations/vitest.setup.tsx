import { beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { server } from "@/mocks/mock-server";
import { mockNextjsModules } from "./setup-nextjs-mocks";
import { mockAuthRequest } from "./mock-auth-request";
import { cleanup } from "@testing-library/react";

// React 18.3 only ships `cache` under the `react-server` export condition.
// Vitest doesn't set that condition, so any module that imports `cache` from
// "react" (e.g. server-only helpers wrapped for per-request memoization) blows
// up with "cache is not a function" the moment its file is evaluated. Shim it
// to identity here — the cache contract degrades to "no deduplication," which
// is the correct semantics in a unit-test context.
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  };
});

beforeAll(() => {
  mockNextjsModules();
  mockAuthRequest(); // If you need user's data - please mock auth actions in your specific test - it sends null user [It's only to avoid cookies() call]
  return server.listen({ onUnhandledRequest: "error" });
});
beforeEach(async () => {
  const { environment } = await import("@/services/environment");
  if (
    typeof (environment as { isServerSide?: unknown }).isServerSide !==
    "function"
  ) {
    return;
  }
  const { useOrgTeamStore } = await import("@/services/org-team/store");
  useOrgTeamStore.setState({
    activeOrgID: null,
    activeTeamID: null,
    orgs: [],
    teams: [],
    isLoaded: true,
  });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
