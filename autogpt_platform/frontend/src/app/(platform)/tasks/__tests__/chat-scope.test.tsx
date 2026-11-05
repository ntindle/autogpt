import { server } from "@/mocks/mock-server";
import { getGetWorkspaceTaskSessionScopeQueryKey } from "@/app/api/__generated__/endpoints/tasks/tasks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useOrgTeamStore } from "@/services/org-team/store";
import { isProtectedPage } from "@/lib/auth/helpers";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TaskChatPage from "../chat/[sessionId]/page";

const { router } = vi.hoisted(() => ({ router: { replace: vi.fn() } }));
function renderPage(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskChatPage />
    </QueryClientProvider>,
  );
}
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useParams: () => ({ sessionId: "saved-session" }),
  usePathname: () => "/tasks/chat/saved-session",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  router.replace.mockReset();
  useOrgTeamStore.setState({
    activeOrgID: "other-org",
    activeTeamID: "other-team",
    isLoaded: true,
  });
});
afterEach(() => {
  cleanup();
  useOrgTeamStore.getState().clearContext();
});

test.each([
  {
    organization_id: "saved-org",
    team_id: "saved-team",
    organization: "saved-org",
    team: "saved-team",
  },
  {
    organization_id: null,
    team_id: null,
    organization: "__personal__",
    team: "__org_home__",
  },
])(
  "opens the saved conversation scope after switching organizations: $organization",
  async ({ organization_id, team_id, organization, team }) => {
    server.use(
      http.get("/api/proxy/api/tasks/conversation/saved-session/scope", () =>
        HttpResponse.json({ organization_id, team_id }),
      ),
    );
    renderPage();
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/copilot?sessionId=saved-session&organizationId=${organization}&teamId=${team}`,
      ),
    );
    expect(isProtectedPage("/tasks/chat/saved-session")).toBe(true);
  },
);

test("an unavailable conversation does not fall back to the selected organization", async () => {
  server.use(
    http.get("/api/proxy/api/tasks/conversation/saved-session/scope", () =>
      HttpResponse.json({ detail: "Conversation not found" }, { status: 404 }),
    ),
  );
  renderPage();
  await screen.findByText("This conversation is not available.");
  expect(router.replace).not.toHaveBeenCalled();
});

test("cached scope cannot reopen a conversation after access is revoked", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    getGetWorkspaceTaskSessionScopeQueryKey("saved-session"),
    {
      data: { organization_id: "saved-org", team_id: "saved-team" },
      status: 200,
      headers: new Headers(),
    },
  );
  server.use(
    http.get("/api/proxy/api/tasks/conversation/saved-session/scope", () =>
      HttpResponse.json({ detail: "Conversation not found" }, { status: 404 }),
    ),
  );
  renderPage(queryClient);
  await screen.findByText("This conversation is not available.");
  expect(router.replace).not.toHaveBeenCalled();
});
