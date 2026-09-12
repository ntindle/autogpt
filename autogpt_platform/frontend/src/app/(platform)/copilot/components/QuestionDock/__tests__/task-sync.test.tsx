import { useListWorkspaceTasks } from "@/app/api/__generated__/endpoints/tasks/tasks";
import { useGetHomeDashboard } from "@/app/api/__generated__/endpoints/home/home";
import {
  getListWorkspaceTasksMockHandler,
  getCommandWorkspaceTaskMockHandler200,
} from "@/app/api/__generated__/endpoints/tasks/tasks.msw";
import type { WorkspaceTask } from "@/app/api/__generated__/models/workspaceTask";
import { okData } from "@/app/api/helpers";
import { server } from "@/mocks/mock-server";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@/tests/integrations/test-utils";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { UIMessage } from "ai";
import { CopilotChatActionsProvider } from "../../CopilotChatActionsProvider/CopilotChatActionsProvider";
import { useCopilotUIStore } from "../../../store";
import { ToolChain } from "../../ToolChain/ToolChain";
import { PendingQuestionsContext } from "../PendingQuestionsContext";
import { getPendingQuestions } from "../helpers";
import { QuestionDock } from "../QuestionDock";

const question = {
  id: "question-1",
  questions: [{ question: "Which material?", keyword: "material" }],
  answers: null,
};
let task: WorkspaceTask;
const onSend = vi.fn();
const command = vi.fn();
let fail = false;
const message: UIMessage = {
  id: "assistant-1",
  role: "assistant",
  parts: [
    {
      type: "tool-ask_question",
      toolCallId: "call-1",
      state: "output-available",
      input: {},
      output: {
        type: "agent_builder_clarification_needed",
        questions: question.questions,
        task_id: "original-parent",
        task_question_id: question.id,
      },
    },
  ],
};

function Surfaces() {
  const tasks = useListWorkspaceTasks({ query: { select: okData } });
  const home = useGetHomeDashboard({ query: { select: okData } });
  return (
    <>
      <output aria-label="Task answer">
        {tasks.data?.tasks[0]?.question?.answers?.material ?? "Waiting"}
      </output>
      <output aria-label="Home reminders">
        {home.data?.attention.length ?? "Loading"}
      </output>
    </>
  );
}
const connector: UIMessage["parts"][number] = {
  type: "tool-run_block",
  toolCallId: "connected-tool",
  state: "output-available",
  input: {},
  output: {
    type: "setup_requirements",
    setup_info: { agent_id: "fictional", agent_name: "Connected integration" },
  },
};

vi.mock("../../SetupRequirementsCard/SetupRequirementsCard", async () => {
  const { useContext, useEffect } = await import("react");
  const { ChainActionsContext } = await import("../../ToolChain/chainActions");
  function SetupRequirementsCard() {
    const chain = useContext(ChainActionsContext);
    useEffect(() => {
      if (!chain) return;
      chain.register({
        id: "connector",
        ready: true,
        justConnected: true,
        buildMessage: () => "The integration is connected.",
      });
      return () => chain.unregister("connector");
    }, [chain]);
    return null;
  }
  return { SetupRequirementsCard };
});

function Chain({ connected = false }: { connected?: boolean }) {
  return (
    <CopilotChatActionsProvider onSend={onSend}>
      <PendingQuestionsContext.Provider value={getPendingQuestions([message])}>
        <ToolChain
          parts={connected ? [connector, ...message.parts] : message.parts}
          isStreaming={false}
        />
      </PendingQuestionsContext.Provider>
      <Surfaces />
    </CopilotChatActionsProvider>
  );
}
beforeEach(() => {
  command.mockReset();
  onSend.mockReset();
  fail = false;
  useCopilotUIStore.setState({ initialPrompt: null, sentMessageCount: 0 });
  task = {
    id: "moved-child",
    user_id: "user-1",
    title: "Choose materials",
    version: 9,
    status: "needs_you",
    plan_only: true,
    question,
  };
  server.use(
    getListWorkspaceTasksMockHandler(() => ({ tasks: [task], assignees: [] })),
    http.get("*/api/home", () =>
      HttpResponse.json({
        attention: task.question?.answers ? [] : [{ id: question.id }],
      }),
    ),
    getCommandWorkspaceTaskMockHandler200(async ({ request }) => {
      const body = (await request.json()) as {
        answers: Record<string, string>;
      };
      command({ url: request.url, body });
      if (fail) throw new Error("Synthetic save failure");
      task = {
        ...task,
        status: "todo",
        question: { ...question, answers: body.answers },
        version: 10,
      };
      return task;
    }),
  );
});
afterEach(cleanup);

test("chain answers resolve the preserved question after nesting and refresh Tasks and Home without a second chat turn", async () => {
  render(<Chain />);
  await waitFor(() =>
    expect(screen.getByLabelText("Home reminders").textContent).toBe("1"),
  );
  await userEvent.type(
    await screen.findByRole("textbox", { name: "Which material?" }),
    "Linen",
  );
  expect(command).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Submit answers" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Task answer").textContent).toBe("Linen"),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Home reminders").textContent).toBe("0"),
  );
  expect(command).toHaveBeenCalledOnce();
  expect(command.mock.calls[0][0]).toEqual({
    url: expect.stringContaining("moved-child"),
    body: {
      operation: "answer",
      version: 9,
      question_id: "question-1",
      answers: { material: "Linen" },
      feedback: "",
    },
  });
  expect(onSend).not.toHaveBeenCalled();
  expect(useCopilotUIStore.getState().initialPrompt).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Which material?" })).toBeNull();
  cleanup();
  render(
    <CopilotChatActionsProvider onSend={onSend}>
      <QuestionDock messages={[message]} />
    </CopilotChatActionsProvider>,
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("textbox", { name: "Which material?" }),
    ).toBeNull(),
  );
});

test("a failed answer keeps its draft and reminder until a successful retry", async () => {
  fail = true;
  render(<Chain />);
  await userEvent.type(
    await screen.findByRole("textbox", { name: "Which material?" }),
    "Cotton",
  );
  await userEvent.click(screen.getByRole("button", { name: "Submit answers" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(
    (
      screen.getByRole("textbox", {
        name: "Which material?",
      }) as HTMLInputElement
    ).value,
  ).toBe("Cotton");
  expect(screen.getByLabelText("Task answer").textContent).toBe("Waiting");
  expect(screen.getByLabelText("Home reminders").textContent).toBe("1");
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Submit answers" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Task answer").textContent).toBe("Cotton"),
  );
  expect(onSend).not.toHaveBeenCalled();
});

test("a task answer and ready connector share exactly one continuation", async () => {
  render(<Chain connected />);
  await userEvent.type(
    await screen.findByRole("textbox", { name: "Which material?" }),
    "Linen",
  );
  await userEvent.click(screen.getByRole("button", { name: "Submit answers" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Task answer").textContent).toBe("Linen"),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("textbox", { name: "Which material?" }),
    ).toBeNull(),
  );
  expect(command).toHaveBeenCalledOnce();
  expect(command.mock.calls[0][0].body.feedback).toBe(
    "The integration is connected.",
  );
  expect(onSend).not.toHaveBeenCalled();
});
