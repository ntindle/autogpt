import {
  getListWorkspaceTasksMockHandler,
  getPreviewWorkspaceTaskBreakdownMockHandler200,
  getAcceptWorkspaceTaskBreakdownMockHandler200,
} from "@/app/api/__generated__/endpoints/tasks/tasks.msw";
import type { TaskBreakdownRequest } from "@/app/api/__generated__/models/taskBreakdownRequest";
import type { WorkspaceTask } from "@/app/api/__generated__/models/workspaceTask";
import { server } from "@/mocks/mock-server";
import { render, screen, waitFor } from "@/tests/integrations/test-utils";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import TasksPage from "../page";

const SELF = {
  id: "user-1",
  kind: "human" as const,
  name: "You",
  reason: "The final material choice is yours.",
};

test("D3 generates inline, refines the edited draft, and accepts edited deliverables", async () => {
  sessionStorage.clear();
  let task: WorkspaceTask = {
    id: "task-1",
    user_id: "user-1",
    title: "Prepare sample kits",
    version: 1,
    status: "todo",
  };
  const generated = vi.fn();
  const accepted = vi.fn();
  server.use(
    getListWorkspaceTasksMockHandler(() => ({
      tasks: [task],
      assignees: [SELF],
    })),
    getPreviewWorkspaceTaskBreakdownMockHandler200(async ({ request }) => {
      const body = (await request.json()) as TaskBreakdownRequest;
      generated(body);
      const revision = generated.mock.calls.length;
      task = {
        ...task,
        breakdown: {
          id: `preview-${revision}`,
          context: "context",
          state: "ready",
          detail: "steps",
          guidance: body.guidance ?? "",
          steps: [
            {
              id: `contents-${revision}`,
              title:
                revision === 1
                  ? "Choose kit contents"
                  : "Choose contents for 50 kits",
              description:
                body.current_steps?.[0]?.description ??
                "A reviewed material list",
              suggestion: SELF,
            },
          ],
        },
      };
      return task;
    }),
    getAcceptWorkspaceTaskBreakdownMockHandler200(async ({ request }) => {
      accepted(await request.json());
      return task;
    }),
  );
  render(<TasksPage />);
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Break down Prepare sample kits",
    }),
  );
  expect(
    await screen.findByRole("region", {
      name: "Breakdown for Prepare sample kits",
    }),
  ).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  await screen.findByRole("textbox", { name: "Step 1" });
  expect(generated).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("textbox", { name: "Deliverable for step 1" }),
  ).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Show details for step 1" }),
  );
  expect(screen.getByText(/Why You:/)).toBeTruthy();
  const deliverable = screen.getByRole("textbox", {
    name: "Deliverable for step 1",
  });
  await userEvent.clear(deliverable);
  await userEvent.type(
    deliverable,
    "Keep the approved linen and cotton selection",
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Refine the breakdown" }),
    "Plan a first batch of 50 kits",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Send refinement" }),
  );
  await waitFor(() => expect(generated).toHaveBeenCalledTimes(2));
  expect(generated.mock.calls[1][0]).toMatchObject({
    preview_id: "preview-1",
    guidance: "Plan a first batch of 50 kits",
    current_steps: [
      {
        id: "contents-1",
        title: "Choose kit contents",
        description: "Keep the approved linen and cotton selection",
        assignee: SELF,
      },
    ],
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("textbox", { name: "Step 1" }) as HTMLInputElement)
        .value,
    ).toBe("Choose contents for 50 kits"),
  );
  expect(screen.getByText("Plan a first batch of 50 kits")).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "Show details for step 1" }),
  );
  expect(
    (
      screen.getByRole("textbox", {
        name: "Deliverable for step 1",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Keep the approved linen and cotton selection");
  expect(accepted).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Accept 1 selected step" }),
  );
  await waitFor(() =>
    expect(accepted).toHaveBeenCalledWith({
      preview_id: "preview-2",
      steps: [
        {
          id: "contents-2",
          title: "Choose contents for 50 kits",
          description: "Keep the approved linen and cotton selection",
          assignee: SELF,
        },
      ],
    }),
  );
});
