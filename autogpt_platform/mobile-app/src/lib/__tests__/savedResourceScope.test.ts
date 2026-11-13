import { apiRequest } from "../api/client";
import { createSession } from "../api/chat";
import {
  downloadFileText,
  fileImageHeaders,
  listSessionFiles,
  workspaceKeys,
  type WorkspaceFile,
} from "../api/workspace";
import { workspaceFetch } from "../workspaceAccess";

jest.mock("../env", () => ({ API_URL: "https://workspace.example.com/_agpt" }));
jest.mock("../auth/token", () => ({
  getAccessToken: jest.fn().mockResolvedValue("fake-user-token"),
  clearAccessToken: jest.fn(),
}));
jest.mock("../workspaceAccess", () => ({
  workspaceFetch: jest.fn(),
  workspaceAccessHeaders: jest.fn(async (_url, headers) => headers),
}));

const fetcher = jest.mocked(workspaceFetch);
const saved = { organization_id: "saved-org", team_id: "saved-team" };

function response(data: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => data,
    text: async () => "file content",
  } as Response;
}

beforeEach(() => fetcher.mockReset());

test("resolves the saved conversation scope before a write and keeps it on token retry", async () => {
  fetcher
    .mockResolvedValueOnce(response(saved))
    .mockResolvedValueOnce(response({}, 401))
    .mockResolvedValueOnce(response({ cancelled: true }));
  await apiRequest("/api/chat/sessions/chat-a/cancel", { method: "POST" });
  expect(fetcher.mock.calls[0][0]).toContain(
    "/api/tasks/conversation/chat-a/scope",
  );
  for (const [, init] of fetcher.mock.calls.slice(1)) {
    expect(init?.headers).toMatchObject({
      "X-Org-Id": "saved-org",
      "X-Team-Id": "saved-team",
      Authorization: "Bearer fake-user-token",
    });
  }
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test("a refused saved-scope lookup prevents the conversation request", async () => {
  fetcher.mockResolvedValueOnce(
    response({ detail: "Conversation not found" }, 404),
  );
  await expect(
    apiRequest("/api/chat/sessions/chat-a/cancel", { method: "POST" }),
  ).rejects.toMatchObject({ status: 404 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("legacy personal sessions send no selected-navigation headers", async () => {
  fetcher
    .mockResolvedValueOnce(response({ organization_id: null, team_id: null }))
    .mockResolvedValueOnce(response({ files: [] }));
  await listSessionFiles("legacy-chat");
  expect(fetcher.mock.calls[1][1]?.headers).toEqual({
    Authorization: "Bearer fake-user-token",
  });
});

test("file listing and expert chat creation use their resource's saved team", async () => {
  fetcher
    .mockResolvedValueOnce(response(saved))
    .mockResolvedValueOnce(response({ files: [] }));
  await listSessionFiles("chat-a");
  expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
    "X-Org-Id": "saved-org",
    "X-Team-Id": "saved-team",
  });
  fetcher.mockReset();
  fetcher
    .mockResolvedValueOnce(response(saved))
    .mockResolvedValueOnce(response({ id: "new-chat" }));
  await createSession("expert-a");
  expect(fetcher.mock.calls[0][0]).toContain("/api/experts/expert-a");
  expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
    "X-Org-Id": "saved-org",
    "X-Team-Id": "saved-team",
  });
});

test("downloads and image headers retain file scope and separate team caches", async () => {
  const file = {
    id: "file-a",
    name: "note.txt",
    mime_type: "text/plain",
    size_bytes: 12,
    ...saved,
  } as WorkspaceFile;
  fetcher.mockResolvedValue(response({}));
  expect(await downloadFileText(file)).toEqual({
    text: "file content",
    isPreview: false,
  });
  expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
    "X-Org-Id": "saved-org",
    "X-Team-Id": "saved-team",
  });
  expect(await fileImageHeaders(file)).toMatchObject({
    "X-Org-Id": "saved-org",
    "X-Team-Id": "saved-team",
  });
  expect(workspaceKeys.imageHeaders(file)).not.toEqual(
    workspaceKeys.imageHeaders({ ...file, team_id: "other-team" }),
  );
});
