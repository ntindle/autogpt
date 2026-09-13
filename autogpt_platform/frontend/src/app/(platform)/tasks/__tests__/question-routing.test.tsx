import {
  getListWorkspaceTasksMockHandler,
  getCommandWorkspaceTaskMockHandler200,
} from "@/app/api/__generated__/endpoints/tasks/tasks.msw";
import type { WorkspaceTask } from "@/app/api/__generated__/models/workspaceTask";
import type { TaskCommand } from "@/app/api/__generated__/models/taskCommand";
import { server } from "@/mocks/mock-server";
import {
  render,
  screen,
  within,
  waitFor,
} from "@/tests/integrations/test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import TasksPage from "../page";

const YOU = { kind: "human" as const, id: "user-1", name: "You" };
const EXPERT = { kind: "expert" as const, id: "expert-1", name: "Strategist" };
const OWNER = { kind: "expert" as const, id: "expert-2", name: "Researcher" };
function task(): WorkspaceTask {
  return {
    id: "source",
    user_id: "user-1",
    title: "Research retailers",
    status: "needs_you",
    assignee: OWNER,
    version: 1,
    question: {
      id: "questions-1",
      questions: [
        {
          keyword: "setup",
          question: "Connect the account?",
          purpose: "account_setup",
        },
        {
          keyword: "strategy",
          question: "How should online retailers be handled?",
        },
      ],
    },
  };
}
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

test("redirect a strategy question while keeping setup and its draft with You", async () => {
  let item = task();
  const command = vi.fn();
  server.use(
    getListWorkspaceTasksMockHandler(() => ({
      tasks: [item],
      assignees: [YOU, EXPERT, OWNER],
    })),
    getCommandWorkspaceTaskMockHandler200(async ({ request }) => {
      const body = (await request.json()) as TaskCommand;
      command(body);
      if (body.operation === "route_question")
        item = {
          ...item,
          version: 2,
          question: {
            ...item.question!,
            questions: item.question!.questions.map((q) =>
              q.keyword === "strategy" ? { ...q, target: EXPERT } : q,
            ),
          },
        };
      return item;
    }),
  );
  render(<TasksPage />);
  await userEvent.click(
    await screen.findByRole("button", { name: /^Research retailers/ }),
  );
  const question = screen.getByRole("region", { name: "Task questions" });
  const setup = within(question).getByRole("textbox", {
    name: "Connect the account?",
  });
  await userEvent.type(setup, "Use the existing connection");
  expect(
    within(question).getByRole("combobox", {
      name: "Who should answer: Connect the account?",
    }),
  ).toHaveProperty("disabled", true);
  await userEvent.selectOptions(
    within(question).getByRole("combobox", {
      name: "Who should answer: How should online retailers be handled?",
    }),
    "expert:expert-1",
  );
  await within(question).findByText(/Waiting for Strategist/);
  expect(setup).toHaveProperty("value", "Use the existing connection");
  expect(
    within(question).queryByRole("textbox", {
      name: "How should online retailers be handled?",
    }),
  ).toBeNull();
  await userEvent.click(
    within(question).getByRole("button", { name: "Submit Answers" }),
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "answer",
        answers: { setup: "Use the existing connection" },
      }),
    ),
  );
  expect(command).not.toHaveBeenCalledWith(
    expect.objectContaining({ operation: "assign" }),
  );
});

test("a draft with questions has one row and one review panel", async () => {
  let source: WorkspaceTask = {
    ...task(),
    result: "Initial report",
    result_version: 1,
  };
  server.use(
    getListWorkspaceTasksMockHandler(() => ({
      tasks: [
        source,
        {
          id: "review",
          user_id: YOU.id,
          title: "Approve report",
          status: "needs_you",
          assignee: YOU,
          review_of: source.id,
          review_version: 1,
        },
      ],
      assignees: [YOU, EXPERT, OWNER],
    })),
    getCommandWorkspaceTaskMockHandler200(async ({ request }) => {
      const command = (await request.json()) as TaskCommand;
      source = {
        ...source,
        version: 2,
        status: "working",
        dispatch_state: "sent",
        question: { ...source.question!, answers: command.answers },
      };
      return source;
    }),
  );
  render(<TasksPage />);
  expect(await screen.findByText("Draft ready · Answer needed")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Approve report/ })).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: /^Research retailers/ }),
  );
  expect(
    screen.getByRole("textbox", { name: "Connect the account?" }),
  ).toBeTruthy();
  expect(screen.getByText(/This draft has outstanding questions/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Resolve questions before accepting" }),
  ).toHaveProperty("disabled", true);
  await userEvent.type(
    screen.getByRole("textbox", { name: "Connect the account?" }),
    "Use the current connection",
  );
  await userEvent.type(
    screen.getByRole("textbox", {
      name: "How should online retailers be handled?",
    }),
    "Use a national directory",
  );
  await userEvent.click(screen.getByRole("button", { name: "Submit Answers" }));
  await screen.findByText(
    "Waiting for the task owner to submit an updated result.",
  );
  expect(screen.queryByRole("button", { name: /^Approve report/ })).toBeNull();
});
