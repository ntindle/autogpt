import { CopilotTenantScopeProvider } from "../../../CopilotTenantScopeContext";
import { useCopilotUIStore } from "../../../store";
import { useOrgTeamStore } from "@/services/org-team/store";
import { server } from "@/mocks/mock-server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConnectionPicker } from "../components/ConnectionPicker/useConnectionPicker";
import { useNoAIConnectionNotice } from "../components/NoAIConnectionNotice/useNoAIConnectionNotice";
import { useConnectedIntegrations } from "../useConnectedIntegrations";
import { openOAuthPopup } from "@/lib/oauth-popup";

vi.mock("@/lib/oauth-popup", () => ({
  preOpenOAuthPopup: vi.fn(() => null),
  openOAuthPopup: vi.fn(),
}));

function ChatConnections({ expertID }: { expertID?: string }) {
  const picker = useConnectionPicker();
  const notice = useNoAIConnectionNotice(true);
  const integrations = useConnectedIntegrations(expertID);
  return (
    <>
      <span data-testid="connection">{picker.active?.display_name}</span>
      <span data-testid="notice">{String(notice.hasNoConnection)}</span>
      <span data-testid="integrations">
        {integrations.map((c) => c.credentialId).join(",")}
      </span>
      <button onClick={() => void picker.connectChatGPT()}>Connect</button>
    </>
  );
}

function renderChat(organizationID: string | null, expertID?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CopilotTenantScopeProvider organizationId={organizationID} teamId={null}>
        <ChatConnections expertID={expertID} />
      </CopilotTenantScopeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useOrgTeamStore.setState({ activeOrgID: "org-b", activeTeamID: null });
  useCopilotUIStore.setState({
    copilotLlmAuth: null,
    copilotLlmModel: "standard",
  });
  server.use(
    http.get("*/api/chat/connections", ({ request }) => {
      const org = request.headers.get("X-Org-Id") || "personal";
      return HttpResponse.json({
        offers: [
          {
            offer_id: `platform:${org}`,
            auth_provider: "platform",
            provider_family: "autogpt",
            display_name: org,
            auth_method: "deployment",
            credential_id: null,
            backed_by_label: org,
            description: org,
            state: "ready",
            selectable: true,
            is_default: true,
            tiers: [],
            limitations: [],
          },
        ],
      });
    }),
    http.get("*/api/chat/transports", ({ request }) =>
      HttpResponse.json({
        transports:
          request.headers.get("X-Org-Id") === "org-b"
            ? [
                {
                  auth_provider: "platform",
                  available: true,
                  credential_id: null,
                },
              ]
            : [],
      }),
    ),
    http.get("*/api/integrations/credentials", ({ request }) =>
      HttpResponse.json([
        {
          id: `credential:${request.headers.get("X-Org-Id") || "personal"}`,
          provider: "google",
          type: "oauth2",
          title: "Gmail",
          username: null,
          scopes: [],
        },
      ]),
    ),
    http.get("*/api/experts/:id/credentials", ({ request }) =>
      HttpResponse.json([
        {
          credential_id: `credential:${request.headers.get("X-Org-Id") || "personal"}`,
          provider: "google",
          type: "oauth2",
          title: "Gmail",
        },
      ]),
    ),
  );
});

afterEach(() => {
  useOrgTeamStore.setState({ activeOrgID: null, activeTeamID: null });
  vi.clearAllMocks();
});

it.each([undefined, "expert-a"])(
  "keeps saved or explicit chat org A under active B (expert %s)",
  async (expertID) => {
    renderChat("org-a", expertID);
    await waitFor(() =>
      expect(screen.getByTestId("connection").textContent).toBe("org-a"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("notice").textContent).toBe("true"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("integrations").textContent).toBe(
        "credential:org-a",
      ),
    );
  },
);

it("keeps explicit personal chat scope under active B", async () => {
  renderChat(null);
  await waitFor(() =>
    expect(screen.getByTestId("connection").textContent).toBe("personal"),
  );
  await waitFor(() =>
    expect(screen.getByTestId("integrations").textContent).toBe(
      "credential:personal",
    ),
  );
});

it("starts OAuth in chat org A and keeps the callback there after navigation changes", async () => {
  const requests: string[] = [];
  let resolvePopup!: (value: { code: string; state: string }) => void;
  vi.mocked(openOAuthPopup).mockReturnValue({
    promise: new Promise((resolve) => {
      resolvePopup = resolve;
    }),
    cleanup: { abort: vi.fn(), signal: new AbortController().signal },
    popupBlocked: false,
    fallbackBlocked: false,
  });
  server.use(
    http.get("*/api/integrations/codex/login", ({ request }) => {
      requests.push(`login:${request.headers.get("X-Org-Id")}`);
      return HttpResponse.json({
        login_url: "https://example.test/oauth",
        state_token: "state",
      });
    }),
    http.post("*/api/integrations/codex/callback", ({ request }) => {
      requests.push(`callback:${request.headers.get("X-Org-Id")}`);
      return HttpResponse.json({
        id: "codex-a",
        provider: "codex",
        type: "oauth2",
      });
    }),
  );
  renderChat("org-a");
  fireEvent.click(screen.getByText("Connect"));
  await waitFor(() => expect(openOAuthPopup).toHaveBeenCalledOnce());
  act(() => useOrgTeamStore.setState({ activeOrgID: "org-c" }));
  await act(async () => resolvePopup({ code: "fake-code", state: "state" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests).toEqual(["login:org-a", "callback:org-a"]);
});
