import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, expect, it } from "vitest";
import { useGetV1ListCredentials } from "@/app/api/__generated__/endpoints/integrations/integrations";
import { server } from "@/mocks/mock-server";
import { useOrgTeamStore } from "@/services/org-team/store";
import { useOrgConnectionScope } from "../useOrgConnectionScope";

function Connections() {
  const scope = useOrgConnectionScope("credentials");
  const query = useGetV1ListCredentials({
    request: scope.request,
    query: { queryKey: scope.queryKey },
  });
  return (
    <span data-testid="connections">
      {query.data?.status === 200
        ? query.data.data.map((c) => c.id).join(",")
        : "loading"}
    </span>
  );
}

afterEach(() => useOrgTeamStore.setState({ activeOrgID: null }));

it("isolates cached lists and late responses when the same owner switches orgs", async () => {
  let resolveOld!: () => void;
  const oldRequest = new Promise<void>((resolve) => {
    resolveOld = resolve;
  });
  const requests: string[] = [];
  server.use(
    http.get("*/api/integrations/credentials", async ({ request }) => {
      const org = request.headers.get("X-Org-Id") ?? "personal";
      requests.push(org);
      if (org === "org-a") await oldRequest;
      return HttpResponse.json([
        { id: org, provider: "github", type: "api_key" },
      ]);
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  useOrgTeamStore.setState({ activeOrgID: "org-a" });
  render(
    <QueryClientProvider client={client}>
      <Connections />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(requests).toEqual(["org-a"]));
  act(() => useOrgTeamStore.setState({ activeOrgID: "org-b" }));
  await waitFor(() =>
    expect(screen.getByTestId("connections").textContent).toBe("org-b"),
  );
  await act(async () => {
    resolveOld();
    await oldRequest;
  });
  await waitFor(() =>
    expect(
      client.getQueryState([
        "/api/integrations/credentials",
        "organization",
        "org-a",
      ])?.fetchStatus,
    ).toBe("idle"),
  );
  expect(screen.getByTestId("connections").textContent).toBe("org-b");
  expect(requests).toEqual(["org-a", "org-b"]);
});
