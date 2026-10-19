import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderUIMessagePart } from "../isRenderUIPart";
import { server } from "@/mocks/mock-server";
import { render } from "@/tests/integrations/test-utils";
import { useOrgTeamStore } from "@/services/org-team/store";
import { formView } from "@/lib/openui/__tests__/capability-fixtures";
import { CopilotChatActionsProvider } from "../../../components/CopilotChatActionsProvider/CopilotChatActionsProvider";
import { RenderUI } from "../RenderUI";
import { OpenUIScopeProvider } from "../OpenUIScopeContext";

const source = formView(
  'Field("notes", "Notes", "Original", "", false)',
).replace("[form])", '[form], "scoped-view")');
const path = "*/api/chat/sessions/scoped-session/ui-drafts/scoped-view";
const part: RenderUIMessagePart = {
  type: "tool-render_ui",
  toolCallId: "scoped-call",
  state: "output-available",
  input: {},
  output: {
    type: "ui_rendered",
    version: 1,
    session_id: "scoped-session",
    source,
    message: "Review",
  },
};

describe("saved organization draft scope", () => {
  beforeEach(() => {
    localStorage.clear();
    useOrgTeamStore.setState({
      activeOrgID: "active-b",
      activeTeamID: "team-b",
    });
  });

  it.each(["saved-a", null])(
    "pins reads and delayed writes to %s",
    async (organizationId) => {
      const requests: [string, string | null, string | null][] = [];
      server.use(
        http.get(path, ({ request }) => {
          requests.push([
            request.method,
            request.headers.get("X-Org-Id"),
            request.headers.get("X-Team-Id"),
          ]);
          return HttpResponse.json({
            source,
            state: {},
            revision: 0,
            writable: true,
            tool_call_id: "scoped-call",
          });
        }),
        http.put(path, async ({ request }) => {
          requests.push([
            request.method,
            request.headers.get("X-Org-Id"),
            request.headers.get("X-Team-Id"),
          ]);
          const body = (await request.json()) as { state: unknown };
          return HttpResponse.json({
            source,
            state: body.state,
            revision: 1,
            writable: true,
            tool_call_id: "scoped-call",
          });
        }),
      );
      render(
        <OpenUIScopeProvider organizationId={organizationId} teamId={null}>
          <CopilotChatActionsProvider onSend={vi.fn()} chatSurface="copilot">
            <RenderUI part={part} />
          </CopilotChatActionsProvider>
        </OpenUIScopeProvider>,
      );
      fireEvent.change(await screen.findByLabelText("Notes"), {
        target: { value: "Saved A input" },
      });
      useOrgTeamStore.setState({
        activeOrgID: "active-c",
        activeTeamID: "team-c",
      });
      await waitFor(
        () => expect(requests.some(([method]) => method === "PUT")).toBe(true),
        { timeout: 3000 },
      );
      expect(
        requests.every(
          ([, org, team]) => org === (organizationId ?? "") && team === "",
        ),
      ).toBe(true);
    },
  );
});
