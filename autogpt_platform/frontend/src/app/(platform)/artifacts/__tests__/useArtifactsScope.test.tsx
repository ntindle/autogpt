import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useOrgTeamStore } from "@/services/org-team/store";

const { flag, listFiles, listFolders } = vi.hoisted(() => ({
  flag: { enabled: true },
  listFiles: vi.fn(),
  listFolders: vi.fn(),
}));

vi.mock("@/services/feature-flags/use-get-flag", () => ({
  Flag: { SHOW_ORG_SETTINGS: "SHOW_ORG_SETTINGS" },
  useGetFlag: () => flag.enabled,
}));
vi.mock("@/app/api/__generated__/endpoints/workspace/workspace", () => ({
  listWorkspaceFiles: listFiles,
  useListWorkspaceFolders: listFolders,
  getListWorkspaceFoldersQueryKey: () => ["/workspace/folders"],
  useBulkMoveWorkspaceFiles: () => ({}),
  useCreateWorkspaceFolder: () => ({}),
  useDeleteWorkspaceFolder: () => ({}),
  useUpdateWorkspaceFolder: () => ({}),
}));
vi.mock("@/components/molecules/Toast/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { useArtifactsPage } from "../useArtifactsPage";
import { useArtifactsFolders } from "../useArtifactsFolders";

let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  flag.enabled = true;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  useOrgTeamStore.setState({
    activeOrgID: "personal",
    activeTeamID: "default-team",
    isLoaded: true,
  });
  listFiles
    .mockReset()
    .mockResolvedValue({ status: 200, data: { files: [], has_more: false } });
  listFolders.mockReset().mockReturnValue({ data: { folders: [] } });
});

afterEach(() => {
  queryClient.clear();
  useOrgTeamStore.getState().clearContext();
});

const pageOptions = {
  folders: [],
  isFoldersLoading: false,
  isFoldersError: false,
};

it("switches request headers and cached files with the active tenant", async () => {
  listFiles.mockResolvedValue({
    status: 200,
    data: { files: [{ id: "first-file", name: "first.txt" }], has_more: false },
  });
  const { result } = renderHook(() => useArtifactsPage(pageOptions), {
    wrapper,
  });
  await waitFor(() => expect(result.current.files).toHaveLength(1));
  listFiles.mockImplementation(() => new Promise(() => {}));
  act(() =>
    useOrgTeamStore.setState({
      activeOrgID: "shared",
      activeTeamID: "shared-team",
    }),
  );
  await waitFor(() =>
    expect(listFiles).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: { "X-Org-Id": "shared", "X-Team-Id": "shared-team" },
      }),
    ),
  );
  expect(result.current.files).toEqual([]);
});

it("waits for tenant hydration before requesting files", () => {
  useOrgTeamStore.setState({ isLoaded: false });
  renderHook(() => useArtifactsPage(pageOptions), { wrapper });
  expect(listFiles).not.toHaveBeenCalled();
});

it("uses an explicit resource scope for the folder list", () => {
  renderHook(
    () =>
      useArtifactsFolders({ organizationId: "shared", teamId: "shared-team" }),
    { wrapper },
  );
  expect(listFolders.mock.lastCall?.[0].request.headers).toMatchObject({
    "X-Org-Id": "shared",
    "X-Team-Id": "shared-team",
  });
});
