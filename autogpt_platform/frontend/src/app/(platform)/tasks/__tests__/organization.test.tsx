import { useState } from "react";
import { http, HttpResponse } from "msw";
import { expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { server } from "@/mocks/mock-server";
import { render, screen, waitFor } from "@/tests/integrations/test-utils";
import { TaskScopeContext } from "@/services/tasks/TaskScopeContext";
import TasksPage from "../page";

function Workspace() {
  const [organizationId, setOrganizationId] = useState("denton");
  return (
    <TaskScopeContext.Provider
      value={{ organizationId, teamId: null, ready: true }}
    >
      <button onClick={() => setOrganizationId("reviewer")}>
        Switch organization
      </button>
      <TasksPage />
    </TaskScopeContext.Provider>
  );
}

test("switching organizations separates query results and clears the capture draft", async () => {
  const requests: string[] = [];
  server.use(
    http.get("*/api/tasks", ({ request }) => {
      const organizationId = request.headers.get("X-Org-Id") ?? "missing";
      requests.push(organizationId);
      return HttpResponse.json({
        tasks: [
          {
            id: organizationId,
            user_id: "user-1",
            title: `${organizationId} private task`,
            organization_id: organizationId,
            status: "todo",
            version: 1,
          },
        ],
        assignees: [],
      });
    }),
  );
  render(<Workspace />);
  await screen.findByText("denton private task");
  await userEvent.type(
    screen.getByRole("textbox", { name: "Add a task" }),
    "Denton draft",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Switch organization" }),
  );
  await screen.findByText("reviewer private task");
  expect(screen.queryByText("denton private task")).toBeNull();
  await waitFor(() =>
    expect(
      (
        screen.getByRole("textbox", {
          name: "Add a task",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(""),
  );
  expect(requests).toContain("denton");
  expect(requests).toContain("reviewer");
});
