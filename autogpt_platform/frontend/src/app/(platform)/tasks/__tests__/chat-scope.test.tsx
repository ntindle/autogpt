import { server } from "@/mocks/mock-server";
import { render, screen, waitFor } from "@/tests/integrations/test-utils";
import { useOrgTeamStore } from "@/services/org-team/store";
import { isProtectedPage } from "@/lib/auth/helpers";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TaskChatPage from "../chat/[sessionId]/page";

const { router } = vi.hoisted(() => ({ router: { replace: vi.fn() } }));
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
afterEach(() => useOrgTeamStore.getState().clearContext());

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
    render(<TaskChatPage />);
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
  render(<TaskChatPage />);
  await screen.findByText("This conversation is not available.");
  expect(router.replace).not.toHaveBeenCalled();
});
