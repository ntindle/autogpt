import { server } from "@/mocks/mock-server";
import { useOrgTeamStore } from "@/services/org-team/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { useCopilotUIStore } from "../store";
import { useSessionDeletion } from "../useSessionDeletion";
import { getSessionListQueryKey } from "../useSessionList";

test("deletion keeps its captured org and updates the populated scoped cache after switching", async () => {
  const client = new QueryClient();
  const keyA = [
    ...getSessionListQueryKey("org-a", "team-a"),
    { isTenantReady: true },
  ];
  const keyB = [
    ...getSessionListQueryKey("org-b", "team-b"),
    { isTenantReady: true },
  ];
  const data = {
    pages: [{ status: 200, data: { sessions: [{ id: "chat-a" }], total: 1 } }],
    pageParams: [0],
  };
  client.setQueryData(keyA, data);
  client.setQueryData(keyB, data);
  const requests: Array<[string | null, string | null]> = [];
  server.use(
    http.delete("*/api/chat/sessions/chat-a", ({ request }) => {
      requests.push([
        request.headers.get("X-Org-Id"),
        request.headers.get("X-Team-Id"),
      ]);
      return HttpResponse.json({});
    }),
  );
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter>{children}</NuqsTestingAdapter>
      </QueryClientProvider>
    );
  }
  const { result, unmount } = renderHook(useSessionDeletion, {
    wrapper: Wrapper,
  });
  act(() =>
    result.current.requestDelete({
      id: "chat-a",
      title: "Chat",
      organizationId: "org-a",
      teamId: "team-a",
    }),
  );
  act(() =>
    useOrgTeamStore.setState({
      activeOrgID: "org-b",
      activeTeamID: "team-b",
      isLoaded: true,
    }),
  );
  act(() => result.current.confirmDelete());
  await waitFor(() =>
    expect(client.getQueryData(keyA)).toMatchObject({
      pages: [{ data: { sessions: [], total: 0 } }],
    }),
  );
  expect(client.getQueryData(keyB)).toEqual(data);
  expect(requests).toEqual([["org-a", "team-a"]]);
  unmount();
  client.clear();
  useOrgTeamStore.getState().clearContext();
  useCopilotUIStore.getState().setSessionToDelete(null);
});
