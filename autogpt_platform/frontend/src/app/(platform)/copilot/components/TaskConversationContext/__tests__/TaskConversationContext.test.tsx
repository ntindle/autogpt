import { getGetWorkspaceTaskContextMockHandler200 } from "@/app/api/__generated__/endpoints/tasks/tasks.msw";
import { server } from "@/mocks/mock-server";
import { render, screen } from "@/tests/integrations/test-utils";
import { expect, test } from "vitest";
import { TaskConversationContext } from "../TaskConversationContext";

test("a linked chat immediately shows its brief, parent outcome, and real owner", async () => {
  server.use(
    getGetWorkspaceTaskContextMockHandler200({
      task: {
        id: "grid",
        user_id: "user",
        title: "Design the grid",
        description: "Fit the contents selected from needlepoint orders",
        project: "Needlepoint",
        assignee: { kind: "expert", id: "expert", name: "3D designer" },
        status: "todo",
      },
      ancestors: [
        { id: "parent", user_id: "user", title: "Set up sample kits" },
      ],
      children: [],
    }),
  );
  render(<TaskConversationContext sessionId="session" />);
  expect(
    await screen.findByRole("heading", { name: "Design the grid" }),
  ).toBeTruthy();
  expect(
    screen.getByText("Fit the contents selected from needlepoint orders"),
  ).toBeTruthy();
  expect(screen.getByText("Needlepoint / Set up sample kits")).toBeTruthy();
  expect(screen.getByText(/3D designer · todo/)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Back to Tasks" }).getAttribute("href"),
  ).toBe("/tasks");
});
