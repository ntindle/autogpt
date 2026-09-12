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

const commands = vi.fn();
const items: WorkspaceTask[] = [
  {
    id: "website",
    user_id: "user-1",
    title: "Publish sample kits",
    project: "Website",
    version: 1,
    dependencies: ["design", "materials"],
  },
  {
    id: "design",
    user_id: "user-1",
    title: "Approve grid layout",
    project: "Design",
    status: "done",
  },
  {
    id: "materials",
    user_id: "user-1",
    title: "Receive materials",
    project: "Procurement",
  },
  {
    id: "contents",
    user_id: "user-1",
    title: "Choose kit contents",
    project: "Sales",
  },
  {
    id: "child",
    user_id: "user-1",
    title: "Write listing copy",
    project: "Website",
    parent_id: "website",
  },
];

beforeEach(() => {
  sessionStorage.clear();
  commands.mockReset();
  server.use(
    getListWorkspaceTasksMockHandler({ tasks: items, assignees: [] }),
    getCommandWorkspaceTaskMockHandler200(async ({ request }) => {
      commands(await request.json());
      return { ...items[0], version: 2 };
    }),
  );
});

async function openWebsiteTask() {
  render(<TasksPage />);
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Filter by project" }),
    "Website",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Details for Publish sample kits" }),
  );
}

test("editing a task preserves every prerequisite from other projects", async () => {
  await openWebsiteTask();
  const title = screen.getByRole("textbox", { name: "Task title" });
  await userEvent.clear(title);
  await userEvent.type(title, "Publish the approved sample kits");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(commands).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Publish the approved sample kits",
        dependencies: ["design", "materials"],
      }),
    ),
  );
});

test("project filtering still allows several prerequisites across projects", async () => {
  await openWebsiteTask();
  expect(
    (
      screen.getByRole("checkbox", {
        name: "Wait for Approve grid layout (Design)",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(
    (
      screen.getByRole("checkbox", {
        name: "Wait for Receive materials (Procurement)",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(
    screen.queryByRole("checkbox", { name: /Wait for Write listing copy/ }),
  ).toBeNull();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Find prerequisites across projects" }),
    "Sales",
  );
  await userEvent.click(
    screen.getByRole("checkbox", {
      name: "Wait for Choose kit contents (Sales)",
    }),
  );
  await userEvent.click(
    screen.getByRole("checkbox", {
      name: "Wait for Receive materials (Procurement)",
    }),
  );
  expect(commands).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(commands).toHaveBeenCalledWith(
      expect.objectContaining({ dependencies: ["design", "contents"] }),
    ),
  );
});
