import {
  getListWorkspaceTasksMockHandler,
  getAcceptWorkspaceTaskBreakdownMockHandler200,
} from "@/app/api/__generated__/endpoints/tasks/tasks.msw";
import type { WorkspaceTask } from "@/app/api/__generated__/models/workspaceTask";
import { server } from "@/mocks/mock-server";
import { render, screen, waitFor } from "@/tests/integrations/test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import TasksPage from "../page";

const SELF = {
  kind: "human" as const,
  id: "user-1",
  name: "An old profile name",
};
const base: WorkspaceTask = {
  id: "task-1",
  user_id: "user-1",
  title: "Prepare the kit",
  version: 1,
  suggestion: SELF,
  suggestion_state: "ready",
  breakdown: {
    id: "preview-1",
    context: "first",
    state: "ready",
    steps: [{ id: "step-1", title: "Choose parts", suggestion: SELF }],
  },
};

beforeEach(() => sessionStorage.clear());

test("the list displays You for a saved self suggestion after a profile rename", async () => {
  server.use(
    getListWorkspaceTasksMockHandler({ tasks: [base], assignees: [SELF] }),
  );
  render(<TasksPage />);
  expect(
    await screen.findByRole("button", {
      name: "Suggested: You. Change assignee for Prepare the kit",
    }),
  ).toBeTruthy();
  expect(screen.queryByText("An old profile name")).toBeNull();
});

test("automatic breakdown replacement preserves an open draft until the user reviews the update", async () => {
  let current = base;
  const accepted = vi.fn();
  server.use(
    getListWorkspaceTasksMockHandler(() => ({
      tasks: [current],
      assignees: [SELF],
    })),
    getAcceptWorkspaceTaskBreakdownMockHandler200(async ({ request }) => {
      accepted(await request.json());
      return current;
    }),
  );
  render(<TasksPage />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Break down Prepare the kit" }),
  );
  const title = screen.getByRole("textbox", { name: "Step 1" });
  await userEvent.clear(title);
  await userEvent.type(title, "Keep my edited scope");
  current = {
    ...base,
    breakdown: {
      id: "preview-2",
      context: "changed",
      state: "ready",
      steps: [
        {
          id: "new-step",
          title: "Use the approved materials",
          suggestion: SELF,
        },
      ],
    },
  };
  const review = await screen.findByRole(
    "button",
    { name: "Review updated suggestion" },
    { timeout: 8000 },
  );
  expect(
    (screen.getByRole("textbox", { name: "Step 1" }) as HTMLInputElement).value,
  ).toBe("Keep my edited scope");
  expect(accepted).not.toHaveBeenCalled();
  await userEvent.click(review);
  expect(
    (screen.getByRole("textbox", { name: "Step 1" }) as HTMLInputElement).value,
  ).toBe("Use the approved materials");
  await userEvent.click(
    screen.getByRole("button", { name: "Accept 1 selected step" }),
  );
  await waitFor(() =>
    expect(accepted).toHaveBeenCalledWith(
      expect.objectContaining({
        preview_id: "preview-2",
        steps: [
          expect.objectContaining({
            id: "new-step",
            title: "Use the approved materials",
          }),
        ],
      }),
    ),
  );
}, 15000);
