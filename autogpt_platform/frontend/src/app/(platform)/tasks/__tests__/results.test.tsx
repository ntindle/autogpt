import {
  getListWorkspaceTasksMockHandler,
  getCommandWorkspaceTaskMockHandler200,
} from "@/app/api/__generated__/endpoints/tasks/tasks.msw";
import type { TaskCommand } from "@/app/api/__generated__/models/taskCommand";
import type { WorkspaceTask } from "@/app/api/__generated__/models/workspaceTask";
import { server } from "@/mocks/mock-server";
import {
  render,
  screen,
  waitFor,
  within,
} from "@/tests/integrations/test-utils";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, test, vi } from "vitest";
import TasksPage from "../page";

const YOU = { kind: "human" as const, id: "user-1", name: "You" };
function task(overrides: Partial<WorkspaceTask> = {}): WorkspaceTask {
  return {
    id: "human-task",
    user_id: "user-1",
    title: "Choose sample kit materials",
    version: 4,
    status: "todo",
    assignee: YOU,
    ...overrides,
  };
}
beforeEach(() => sessionStorage.clear());

test("submit a human deliverable, retain it on reload, and show no self-review step", async () => {
  let item = task();
  const submitted = vi.fn();
  server.use(
    getListWorkspaceTasksMockHandler(() => ({
      tasks: [item],
      assignees: [YOU],
    })),
    getCommandWorkspaceTaskMockHandler200(async ({ request }) => {
      const data = (await request.json()) as TaskCommand;
      submitted(data);
      item = task({
        status: "done",
        result: data.evidence,
        result_version: 1,
        version: 5,
      });
      return item;
    }),
  );
  const view = render(<TasksPage />);
  await userEvent.click(
    await screen.findByRole("button", {
      name: /^Choose sample kit materials/,
    }),
  );
  const form = await screen.findByRole("form", { name: "Submit your result" });
  expect(
    within(form).getByRole("button", { name: "Submit result" }),
  ).toHaveProperty("disabled", true);
  const evidence = "Selected linen. https://example.invalid/materials";
  await userEvent.type(
    within(form).getByRole("textbox", { name: "Your result" }),
    evidence,
  );
  await userEvent.click(
    within(form).getByRole("button", { name: "Submit result" }),
  );
  await waitFor(() =>
    expect(submitted).toHaveBeenCalledWith({
      operation: "submit_result",
      version: 4,
      evidence,
    }),
  );
  expect(
    await screen.findByRole("region", { name: "Task result" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Accept result" })).toBeNull();
  await screen.findByRole("button", { name: "Update result" });
  view.unmount();
  render(<TasksPage />);
  expect(
    await screen.findByRole("region", { name: "Task result" }),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "Task result" })).getByRole(
      "button",
      {
        name: "https://example.invalid/materials",
      },
    ),
  ).toBeTruthy();
});

test("failed result submission keeps the full human draft for retry", async () => {
  server.use(
    getListWorkspaceTasksMockHandler({ tasks: [task()], assignees: [YOU] }),
    http.post("/api/proxy/api/tasks/:taskId/commands", () =>
      HttpResponse.json(
        { detail: "Required steps still need completion" },
        { status: 409 },
      ),
    ),
  );
  render(<TasksPage />);
  await userEvent.click(
    await screen.findByRole("button", {
      name: /^Choose sample kit materials/,
    }),
  );
  const form = await screen.findByRole("form", { name: "Submit your result" });
  const input = within(form).getByRole("textbox", { name: "Your result" });
  await userEvent.type(input, "My physical samples and measurements");
  await userEvent.click(
    within(form).getByRole("button", { name: "Submit result" }),
  );
  expect(await within(form).findByRole("alert")).toBeTruthy();
  expect(input).toHaveProperty("value", "My physical samples and measurements");
  expect(
    within(form).getByRole("button", { name: "Submit result" }),
  ).toHaveProperty("disabled", false);
});

test("canceled captures stay out of active views and can be reopened from Canceled", async () => {
  const item = task({
    status: "canceled",
    suggestion: { kind: "auto", id: "auto", name: "AutoPilot" },
  });
  const submitted = vi.fn();
  server.use(
    getListWorkspaceTasksMockHandler({ tasks: [item], assignees: [YOU] }),
    getCommandWorkspaceTaskMockHandler200(async ({ request }) => {
      submitted(await request.json());
      return task();
    }),
  );
  render(<TasksPage />);
  await screen.findByText("Nothing in this view");
  await userEvent.click(screen.getByRole("button", { name: "Suggested" }));
  expect(
    screen.queryByRole("button", {
      name: /^Choose sample kit materials/,
    }),
  ).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Canceled" }));
  await userEvent.click(
    await screen.findByRole("button", {
      name: /^Choose sample kit materials/,
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
  await waitFor(() =>
    expect(submitted).toHaveBeenCalledWith({ operation: "reopen", version: 4 }),
  );
});

test("workspace deliverables are linked and previewable from their review", async () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  const item = task({
    assignee: { kind: "auto", id: "auto", name: "AutoPilot" },
    status: "needs_you",
    result: `Review [biggerarm_plan.md](workspace://${id}#text/markdown)`,
    result_version: 1,
    session_id: "work-session",
  });
  server.use(
    getListWorkspaceTasksMockHandler({ tasks: [item], assignees: [YOU] }),
    http.get("/api/proxy/api/workspace/files", () =>
      HttpResponse.json({
        files: [
          {
            id,
            name: "biggerarm_plan.md",
            path: "/sessions/work-session/biggerarm_plan.md",
            mime_type: "text/markdown",
            size_bytes: 40,
            origin: "generated",
            created_at: "2026-09-13T00:00:00Z",
          },
        ],
        has_more: false,
      }),
    ),
    http.get(`/api/proxy/api/workspace/files/${id}/download`, () =>
      HttpResponse.text(
        "# Biggerarm deliverable\n\nVerified fixture dimensions",
      ),
    ),
  );
  render(<TasksPage />);
  await userEvent.click(
    await screen.findByRole("button", { name: /^Choose sample kit materials/ }),
  );
  expect(screen.queryByText(/\[blocked\]/)).toBeNull();
  const files = await screen.findByRole("region", {
    name: "Deliverable files",
  });
  expect(
    within(files).getByRole("link", { name: "Download" }).getAttribute("href"),
  ).toBe(`/api/proxy/api/workspace/files/${id}/download`);
  await userEvent.click(
    within(files).getByRole("button", { name: "biggerarm_plan.md" }),
  );
  const preview = await screen.findByRole("dialog", {
    name: "biggerarm_plan.md",
  });
  expect(
    await within(preview).findByText("Verified fixture dimensions"),
  ).toBeTruthy();
  await userEvent.click(
    within(preview).getByRole("button", { name: "Back to review" }),
  );
  expect(screen.getByRole("button", { name: "Accept result" })).toBeTruthy();
});
