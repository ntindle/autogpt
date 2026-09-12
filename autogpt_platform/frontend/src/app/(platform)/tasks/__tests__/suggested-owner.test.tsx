import { getListWorkspaceTasksMockHandler } from "@/app/api/__generated__/endpoints/tasks/tasks.msw";
import type { WorkspaceTask } from "@/app/api/__generated__/models/workspaceTask";
import { server } from "@/mocks/mock-server";
import { render, screen, waitFor } from "@/tests/integrations/test-utils";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, expect, test, vi } from "vitest";
import TasksPage from "../page";

const OWNER = { kind: "auto" as const, id: "auto", name: "Otto" };
const TITLE = "Compare camera mounts";
const commands = vi.fn();
let task: WorkspaceTask & { version: number };
let failing = false;

beforeEach(() => {
  sessionStorage.clear();
  commands.mockReset();
  failing = false;
  task = {
    id: "owner-task",
    user_id: "user-1",
    title: TITLE,
    version: 4,
    status: "todo",
    plan_only: true,
    suggestion_state: "ready",
    suggestion_request_id: "owner-request-1",
    suggestion: { ...OWNER, reason: "Otto coordinates the specialists." },
  };
  server.use(
    getListWorkspaceTasksMockHandler(() => ({
      tasks: [task],
      assignees: [OWNER],
    })),
    http.post("/api/proxy/api/tasks/:taskId/commands", async ({ request }) => {
      const body = (await request.json()) as { operation: string };
      commands(body);
      if (failing)
        return HttpResponse.json(
          { detail: "Suggestion changed" },
          { status: 409 },
        );
      task = {
        ...task,
        version: task.version + 1,
        suggestion: null,
        assignee: body.operation === "assign" ? OWNER : null,
      };
      return HttpResponse.json(task);
    }),
  );
});

test("desktop suggestion accept confirms the displayed owner without opening the picker", async () => {
  render(<TasksPage />);
  const trigger = await screen.findByRole("button", {
    name: /Suggested: Otto/,
  });
  await userEvent.hover(trigger);
  expect(commands).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Accept Otto for " + TITLE }),
  );
  await waitFor(() =>
    expect(commands).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "assign",
        version: 4,
        assignee: expect.objectContaining(OWNER),
      }),
    ),
  );
  expect(commands).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("tapping the owner opens a review menu and dismissal keeps the task unassigned", async () => {
  render(<TasksPage />);
  await userEvent.click(
    await screen.findByRole("button", { name: /Suggested: Otto/ }),
  );
  expect(screen.getByText("Otto coordinates the specialists.")).toBeTruthy();
  expect(commands).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() =>
    expect(commands).toHaveBeenCalledWith({
      operation: "dismiss_suggestion",
      version: 4,
      suggestion_request_id: "owner-request-1",
    }),
  );
  expect(
    await screen.findByRole("button", { name: /Assigned to: Unassigned/ }),
  ).toBeTruthy();
  expect(task.assignee).toBeNull();
});

test("failed quick dismissal retains the suggestion and can be retried", async () => {
  failing = true;
  render(<TasksPage />);
  await screen.findByRole("button", { name: /Suggested: Otto/ });
  await userEvent.click(
    screen.getByRole("button", {
      name: "Dismiss suggested owner for " + TITLE,
    }),
  );
  await waitFor(() => expect(commands).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: /Suggested: Otto/ })).toBeTruthy();
  failing = false;
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", {
          name: "Dismiss suggested owner for " + TITLE,
        })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  await userEvent.click(
    screen.getByRole("button", {
      name: "Dismiss suggested owner for " + TITLE,
    }),
  );
  expect(
    await screen.findByRole("button", { name: /Assigned to: Unassigned/ }),
  ).toBeTruthy();
  expect(commands).toHaveBeenCalledTimes(2);
});

test("keyboard acceptance returns focus to the updated owner", async () => {
  render(<TasksPage />);
  const trigger = await screen.findByRole("button", {
    name: /Suggested: Otto/,
  });
  trigger.focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(
    screen.getByRole("button", {
      name: "Accept Otto for " + TITLE,
    }),
  );
  await userEvent.keyboard("{Enter}");
  const assigned = await screen.findByRole("button", {
    name: /Assigned to: Otto/,
  });
  await waitFor(() => expect(document.activeElement).toBe(assigned));
});
