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

test("capture works on a plain HTTP LAN origin without crypto.randomUUID", async () => {
  const originalCrypto = globalThis.crypto;
  vi.stubGlobal("crypto", {
    getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
    randomUUID: undefined,
  });
  try {
    render(<TasksPage />);
    const input = await screen.findByRole("textbox", { name: "Add a task" });
    await userEvent.type(input, "Save over HTTP");
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(created.mock.calls[0][0].id).toMatch(/^[0-9a-f-]{36}$/);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("the suggested identity names the actual Expert and exposes role-specific alternatives", async () => {
  const designer = {
    kind: "expert" as const,
    id: "grid-expert",
    name: "Grid designer",
    role: "3D fabrication",
    reason: "Fits the needlepoint grid design.",
  };
  server.use(
    getListWorkspaceTasksMockHandler({
      tasks: [
        task({
          suggestion: designer,
          suggestion_state: "ready",
          suggestion_alternatives: [
            { ...AUTO, reason: "Coordinates several disciplines." },
          ],
        }),
      ],
      assignees: [designer, AUTO],
    }),
  );
  render(<TasksPage />);
  expect(await screen.findByText("Grid designer")).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: /Suggested: Grid designer/ }),
  );
  expect(screen.getByText("Fits the needlepoint grid design.")).toBeTruthy();
  expect(screen.getByText("Coordinates several disciplines.")).toBeTruthy();
  expect(commands).not.toHaveBeenCalled();
});

test("breakdown stays a selectable editable preview and accepts only the chosen steps", async () => {
  const { getAcceptWorkspaceTaskBreakdownMockHandler200 } = await import(
    "@/app/api/__generated__/endpoints/tasks/tasks.msw"
  );
  const accepted = vi.fn();
  const item = task({
    title: "Set up sample kits",
    breakdown: {
      id: "preview-1",
      context: "snapshot",
      state: "ready",
      steps: [
        {
          id: "grid",
          title: "Design the grid",
          description: "Fit the chosen kit contents",
          suggestion: AUTO,
        },
        {
          id: "website",
          title: "Add kits to the website",
          description: "Prepare product listings",
          suggestion: AUTO,
        },
      ],
    },
  });
  server.use(
    getListWorkspaceTasksMockHandler({ tasks: [item], assignees: [AUTO] }),
    getAcceptWorkspaceTaskBreakdownMockHandler200(async ({ request }) => {
      accepted(await request.json());
      return item;
    }),
  );
  render(<TasksPage />);
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Break down Set up sample kits",
    }),
  );
  expect(await screen.findByText(/Owners remain suggestions/)).toBeTruthy();
  expect(accepted).not.toHaveBeenCalled();
  expect(commands).not.toHaveBeenCalled();
  const title = screen.getByRole("textbox", { name: "Step 1" });
  await userEvent.clear(title);
  await userEvent.type(title, "Design and test the needlepoint grid");
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Include step 2" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Accept 1 selected step" }),
  );
  await waitFor(() =>
    expect(accepted).toHaveBeenCalledWith({
      preview_id: "preview-1",
      steps: [
        {
          id: "grid",
          title: "Design and test the needlepoint grid",
          description: expect.any(String),
          assignee: AUTO,
        },
      ],
    }),
  );
});

test("deselecting a prerequisite also deselects dependent steps", async () => {
  server.use(
    getListWorkspaceTasksMockHandler({
      tasks: [
        task({
          breakdown: {
            id: "preview-deps",
            context: "snapshot",
            state: "ready",
            steps: [
              { id: "grid", title: "Design the grid", suggestion: AUTO },
              {
                id: "bulk",
                title: "Prepare bulk printing",
                suggestion: AUTO,
                dependencies: ["grid"],
              },
            ],
          },
        }),
      ],
      assignees: [AUTO],
    }),
  );
  render(<TasksPage />);
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Break down Compare camera mounts",
    }),
  );
  await userEvent.click(
    await screen.findByRole("checkbox", { name: "Include step 1" }),
  );
  expect(
    screen.getByRole("checkbox", { name: "Include step 2" }),
  ).toHaveProperty("checked", false);
  expect(
    screen.getByRole("button", { name: "Accept 0 selected steps" }),
  ).toHaveProperty("disabled", true);
});
