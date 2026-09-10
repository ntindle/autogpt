import {
  getListWorkspaceTasksMockHandler,
  getCreateWorkspaceTaskMockHandler201,
  getCommandWorkspaceTaskMockHandler200,
} from "@/app/api/__generated__/endpoints/tasks/tasks.msw";
import type { WorkspaceTask } from "@/app/api/__generated__/models/workspaceTask";
import { server } from "@/mocks/mock-server";
import {
  render,
  screen,
  waitFor,
  within,
} from "@/tests/integrations/test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import TasksPage from "../page";

const commands = vi.fn();
const created = vi.fn();
const AUTO = { kind: "auto" as const, id: "auto", name: "Auto" };

function task(overrides: Partial<WorkspaceTask> = {}): WorkspaceTask {
  return {
    id: "task-1",
    user_id: "user-1",
    title: "Compare camera mounts",
    version: 1,
    status: "todo",
    suggestion: { ...AUTO, reason: "Auto can coordinate the comparison." },
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  commands.mockReset();
  created.mockReset();
  server.use(
    getListWorkspaceTasksMockHandler({
      tasks: [task()],
      assignees: [AUTO, { kind: "human", id: "user-1", name: "You" }],
    }),
    getCommandWorkspaceTaskMockHandler200(async ({ request }) => {
      commands(await request.json());
      return task({ version: 2, assignee: AUTO, suggestion: null });
    }),
    getCreateWorkspaceTaskMockHandler201(async ({ request }) => {
      const data = await request.json();
      created(data);
      return task();
    }),
  );
});

test("inspecting a suggested identity does not delegate; confirmation does", async () => {
  render(<TasksPage />);
  await userEvent.click(
    await screen.findByRole("button", { name: /Suggested: Auto/ }),
  );
  expect(screen.getByText("Auto can coordinate the comparison.")).toBeTruthy();
  expect(commands).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm & delegate" }),
  );
  await waitFor(() =>
    expect(commands).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "assign",
        assignee: expect.objectContaining(AUTO),
        version: 1,
      }),
    ),
  );
});

test("pasted lines save separate tasks without assigning or dispatching", async () => {
  render(<TasksPage />);
  const input = await screen.findByRole("textbox", { name: "Add a task" });
  await userEvent.click(input);
  await userEvent.type(
    input,
    "Choose a date{Shift>}{Enter}{/Shift}Write a brief{Shift>}{Enter}{/Shift}Compare suppliers",
  );
  await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(3));
  expect(created.mock.calls.map(([data]) => data.title)).toEqual([
    "Choose a date",
    "Write a brief",
    "Compare suppliers",
  ]);
  expect(commands).not.toHaveBeenCalled();
});

test("parent progress cannot complete unfinished children", async () => {
  server.use(
    getListWorkspaceTasksMockHandler({
      tasks: [
        task({ title: "Launch", suggestion: null }),
        task({
          id: "child",
          title: "Choose a date",
          parent_id: "task-1",
          suggestion: null,
        }),
      ],
      assignees: [AUTO],
    }),
  );
  render(<TasksPage />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Inspect Launch: To do" }),
  );
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(commands).not.toHaveBeenCalled();
  expect(
    within(screen.getByRole("dialog")).getByText("0/1 required steps accepted"),
  ).toBeTruthy();
});

test("human work can be completed without opening a chat", async () => {
  server.use(
    getListWorkspaceTasksMockHandler({
      tasks: [
        task({
          assignee: { kind: "human", id: "user-1", name: "You" },
          suggestion: null,
        }),
      ],
      assignees: [AUTO],
    }),
  );
  render(<TasksPage />);
  await userEvent.click(
    await screen.findByRole("checkbox", {
      name: "Complete Compare camera mounts",
    }),
  );
  await waitFor(() =>
    expect(commands).toHaveBeenCalledWith({
      operation: "complete",
      version: 1,
    }),
  );
});
