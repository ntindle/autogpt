import {
  getListWorkspaceTasksMockHandler,
  getCommandWorkspaceTaskMockHandler200,
} from "@/app/api/__generated__/endpoints/tasks/tasks.msw";
import type { WorkspaceTask } from "@/app/api/__generated__/models/workspaceTask";
import { server } from "@/mocks/mock-server";
import { render, screen, waitFor } from "@/tests/integrations/test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import TasksPage from "../page";

const AUTO = { kind: "auto" as const, id: "auto", name: "AutoPilot" };
const command = vi.fn();
function task(id: string, fields: Partial<WorkspaceTask> = {}): WorkspaceTask {
  return {
    id,
    user_id: "user-1",
    title: id,
    version: 4,
    status: "todo",
    accepted: true,
    ...fields,
  };
}
beforeEach(() => {
  sessionStorage.clear();
  command.mockReset();
});

test("completed, proposed, stopped, and held work have distinct states; Play starts only its task", async () => {
  const work = task("Source BOM", {
    parent_id: "Build robot",
    assignee: AUTO,
    status: "blocked",
    dispatch_state: "finished",
  });
  server.use(
    getListWorkspaceTasksMockHandler({
      tasks: [
        task("Build robot", { plan_only: true }),
        task("Configuration", {
          parent_id: "Build robot",
          status: "done",
          result: "7.4 V configuration",
        }),
        work,
        task("Proposed fixture", {
          accepted: false,
          plan_only: true,
          assignee: AUTO,
        }),
      ],
      assignees: [AUTO],
    }),
    getCommandWorkspaceTaskMockHandler200(async ({ request }) => {
      command({ url: request.url, body: await request.json() });
      return {
        ...work,
        execution_enabled: true,
        dispatch_state: "pending",
        status: "todo",
      };
    }),
  );
  render(<TasksPage />);
  expect(await screen.findByText("Completed")).toBeTruthy();
  expect(screen.getByText("Proposed new work")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Open stopped attempt for Source BOM" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Start Proposed fixture" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Start Configuration" }),
  ).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Start Source BOM" }),
  );
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(command.mock.calls[0][0]).toEqual({
    url: expect.stringContaining("Source%20BOM"),
    body: { operation: "start", version: 4 },
  });
});

test("a started branch shows its unmet prerequisite while its parent remains held", async () => {
  server.use(
    getListWorkspaceTasksMockHandler({
      tasks: [
        task("Build robot", { plan_only: true }),
        task("Configuration"),
        task("Source BOM", {
          parent_id: "Build robot",
          execution_enabled: true,
          assignee: AUTO,
          dependencies: ["Configuration"],
        }),
      ],
      assignees: [AUTO],
    }),
  );
  render(<TasksPage />);
  expect(await screen.findByText("Waiting for prerequisites")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Start Source BOM" })).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Details for Source BOM" }),
  );
  expect(screen.getByText(/Waiting for: Configuration/)).toBeTruthy();
  expect(screen.queryByText(/Execution on hold by Build robot/)).toBeNull();
});
