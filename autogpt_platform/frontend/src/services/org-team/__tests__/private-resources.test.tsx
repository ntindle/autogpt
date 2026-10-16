import { useListExperts } from "@/services/experts/scoped-queries";
import { useListCopilotSkills } from "@/services/skills/scoped-queries";
import { useListSkillLearningDecisions } from "@/services/skill-learning/scoped-queries";
import { useHireExpert } from "@/services/experts/scoped-mutations";
import { useOrgTeamStore } from "@/services/org-team/store";
import { server } from "@/mocks/mock-server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { expect, test } from "vitest";

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  useOrgTeamStore.setState({
    activeOrgID: "org-a",
    activeTeamID: null,
    isLoaded: true,
  });
  return { client, wrapper: Wrapper };
}

const resources: Array<[string, () => { data?: { data: unknown } }]> = [
  ["experts", () => useListExperts()],
  ["skills", () => useListCopilotSkills()],
  ["learning", () => useListSkillLearningDecisions()],
];

for (const [name, useResource] of resources) {
  test(`${name} keeps delayed responses and warm caches in their original org`, async () => {
    const { client, wrapper } = setup();
    const seen: string[] = [];
    let release: () => void = () => {};
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("*/api/*", async ({ request }) => {
        const org = request.headers.get("X-Org-Id")!;
        seen.push(org);
        if (org === "org-a") await delayed;
        return HttpResponse.json([{ name: org }]);
      }),
    );
    const { result } = renderHook(useResource, { wrapper });
    await waitFor(() => expect(seen).toEqual(["org-a"]));
    act(() => useOrgTeamStore.setState({ activeOrgID: "org-b" }));
    await waitFor(() =>
      expect(result.current.data?.data).toEqual([{ name: "org-b" }]),
    );
    await act(async () => {
      release();
      await delayed;
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(result.current.data?.data).toEqual([{ name: "org-b" }]);
    act(() => useOrgTeamStore.setState({ activeOrgID: "org-a" }));
    await waitFor(() =>
      expect(result.current.data?.data).toEqual([{ name: "org-a" }]),
    );
    const requests = seen.length;
    act(() => useOrgTeamStore.setState({ activeOrgID: "org-b" }));
    await waitFor(() =>
      expect(result.current.data?.data).toEqual([{ name: "org-b" }]),
    );
    expect(seen).toHaveLength(requests);
  });
}

test("saved session roster uses explicit org while navigation points elsewhere", async () => {
  const { wrapper } = setup();
  server.use(
    http.get("*/api/experts", ({ request }) =>
      HttpResponse.json([{ name: request.headers.get("X-Org-Id") }]),
    ),
  );
  const { result } = renderHook(
    () => useListExperts(undefined, undefined, { organizationId: "saved-org" }),
    { wrapper },
  );
  await waitFor(() =>
    expect(result.current.data?.data).toEqual([{ name: "saved-org" }]),
  );
});

test("a mutation pins the selected org in its request", async () => {
  const { wrapper } = setup();
  const seen: string[] = [];
  server.use(
    http.post("*/api/experts", ({ request }) => {
      seen.push(request.headers.get("X-Org-Id")!);
      return HttpResponse.json({ expert: { id: "hired" } });
    }),
  );
  const { result } = renderHook(() => useHireExpert(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ data: { template_id: "template" } });
  });
  expect(seen).toEqual(["org-a"]);
});
