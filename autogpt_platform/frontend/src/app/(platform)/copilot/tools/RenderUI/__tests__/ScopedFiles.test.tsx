import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/mocks/mock-server";
import { render } from "@testing-library/react";
import { useAuthStore } from "@/lib/auth/hooks/useAuthStore";
import { useOrgTeamStore } from "@/services/org-team/store";
import { formView } from "@/lib/openui/__tests__/capability-fixtures";
import { OpenUIFileView } from "../../../components/OpenUIFileView/OpenUIFileView";
import { OpenUIScopeProvider } from "../OpenUIScopeContext";
import { registerChatSender } from "../../../helpers/sendToChat";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const source = formView(
  'Field("notes", "Notes", "Original", "", false)',
).replace("[form])", '[form], "saved-view")');
const path = "*/api/workspace/files/saved-file/view-state";

function savedView(overrides: Record<string, unknown> = {}) {
  return {
    file_id: "saved-file",
    view_id: "saved-view",
    source,
    checksum: "same-source",
    state: {},
    revision: 0,
    origin_session_id: "home-chat",
    ...overrides,
  };
}

function fileElement(client: QueryClient, organizationId: string | null) {
  return (
    <QueryClientProvider client={client}>
      <OpenUIScopeProvider organizationId={organizationId} teamId={null}>
        <OpenUIFileView
          fileId="saved-file"
          currentSessionId={null}
          fallback={<p>Missing</p>}
        />
      </OpenUIScopeProvider>
    </QueryClientProvider>
  );
}

describe("saved file request and cache scope", () => {
  const originalUser = useAuthStore.getState().user;
  beforeEach(() => {
    localStorage.clear();
    router.push.mockClear();
    useAuthStore.setState({
      user: { id: "owner-a", email: "owner@example.com", user_metadata: {} },
    });
  });
  afterEach(() => useAuthStore.setState({ user: originalUser }));

  it("pins file edits and origin navigation to returned saved scope after a switch", async () => {
    const writes: string[] = [];
    server.use(
      http.get(path, () =>
        HttpResponse.json(
          savedView({ organization_id: "saved-a", team_id: null }),
        ),
      ),
      http.put(path, async ({ request }) => {
        writes.push(request.headers.get("X-Org-Id") ?? "missing");
        const body = (await request.json()) as { state: unknown };
        return HttpResponse.json(
          savedView({
            organization_id: "saved-a",
            team_id: null,
            state: body.state,
            revision: 1,
          }),
        );
      }),
    );
    const home = vi.fn();
    const stop = registerChatSender("home-chat", home, {
      ownerId: "owner-a",
      organizationId: "saved-a",
      teamId: null,
    });
    try {
      const client = new QueryClient();
      render(fileElement(client, "active-b"));
      fireEvent.change(await screen.findByLabelText("Notes"), {
        target: { value: "Private A edit" },
      });
      useOrgTeamStore.setState({ activeOrgID: "active-c", activeTeamID: null });
      await waitFor(() => expect(writes).toEqual(["saved-a"]), {
        timeout: 3000,
      });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(home).toHaveBeenCalledTimes(1));
      expect(home.mock.calls[0][0]).toContain("Private A edit");
      const href = new URL(router.push.mock.calls[0][0], "http://localhost");
      expect(href.searchParams.get("organizationId")).toBe("saved-a");
      expect(href.searchParams.get("teamId")).toBe("__org_home__");
    } finally {
      stop();
    }
  });

  it("does not reuse cached saved content after an owner or organization change", async () => {
    let denied = false;
    const seen: (string | null)[] = [];
    server.use(
      http.get(path, ({ request }) => {
        seen.push(request.headers.get("X-Org-Id"));
        return denied
          ? HttpResponse.json({ detail: "Not found" }, { status: 404 })
          : HttpResponse.json(
              savedView({
                state: {
                  review: {
                    notes: {
                      value: "Private cached input",
                      componentType: "Field",
                    },
                  },
                },
              }),
            );
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    const ui = render(fileElement(client, "org-a"));
    expect(
      ((await screen.findByLabelText("Notes")) as HTMLInputElement).value,
    ).toBe("Private cached input");
    denied = true;
    useAuthStore.setState({
      user: { id: "owner-b", email: "other@example.com", user_metadata: {} },
    });
    ui.rerender(fileElement(client, "org-b"));
    expect(screen.queryByLabelText("Notes")).toBeNull();
    await screen.findByText("Missing");
    expect(seen).toContain("org-b");
  });
});
