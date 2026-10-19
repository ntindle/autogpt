import type { ToolUIPart, UIDataTypes, UIMessage, UITools } from "ai";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  type ClarifyingQuestion,
  type QuestionAnswer,
  extractClarifyingQuestions,
  formatAnswer,
  isAnswered,
  normalizeClarifyingQuestions,
  questionNeedsHumanAnswer,
} from "../../tools/clarifying-questions";
import type { ChainActionEntry } from "../ToolChain/chainActions";

export interface TaskQuestionBinding {
  taskID: string;
  questionID: string;
}

export interface PendingQuestions {
  taskBinding?: TaskQuestionBinding;
  dockId: string;
  questions: ClarifyingQuestion[];
  /** Tool-call ids of the ask_question parts the questions came from —
   *  lets the tool chain render the answer form on the matching rows. */
  callIds: string[];
}

type Message = UIMessage<unknown, UIDataTypes, UITools>;

const QUESTION_RESPONSE_TYPE = "agent_builder_clarification_needed";

function questionOutput(output: unknown): Record<string, unknown> | null {
  if (typeof output === "string") {
    try {
      output = JSON.parse(output);
    } catch {
      return null;
    }
  }
  if (!output || typeof output !== "object") return null;
  return output as Record<string, unknown>;
}

// Questions are pending only while the asking assistant message is the last
// message — any user reply (answers, skip, or a fresh request) supersedes it.
export function getPendingQuestions(
  messages: Message[],
): PendingQuestions | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return null;

  const questions: ClarifyingQuestion[] = [];
  const callIds: string[] = [];
  let taskBinding: TaskQuestionBinding | undefined;
  for (const part of last.parts) {
    if (!part.type.startsWith("tool-")) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    const tool = part as ToolUIPart;
    const output = questionOutput(tool.output);
    const isQuestionPart =
      part.type === "tool-ask_question" ||
      output?.type === QUESTION_RESPONSE_TYPE;
    if (!isQuestionPart) continue;
    const extracted = extractClarifyingQuestions(tool);
    if (extracted.length === 0) continue;
    if (
      typeof output?.task_id === "string" &&
      typeof output.task_question_id === "string"
    ) {
      taskBinding = {
        taskID: output.task_id,
        questionID: output.task_question_id,
      };
      questions.splice(0, questions.length, ...extracted);
      callIds.splice(0, callIds.length, tool.toolCallId);
    } else if (!taskBinding) {
      questions.push(...extracted);
      callIds.push(tool.toolCallId);
    }
  }
  if (questions.length === 0) return null;

  return {
    ...(taskBinding ? { taskBinding } : {}),
    dockId: `${last.id}:${callIds.join("+")}`,
    questions: normalizeClarifyingQuestions(questions),
    callIds,
  };
}

export function buildAnswersMessage(
  questions: ClarifyingQuestion[],
  answers: Record<string, QuestionAnswer>,
): string {
  const body = questions
    .map((q) => `> ${q.question}\n\n${formatAnswer(answers[q.keyword])}`)
    .join("\n\n");
  return `**Here are my answers:**\n\n${body}\n\nPlease proceed.`;
}

type Answers = Record<string, QuestionAnswer>;

interface QuestionsEntryArgs {
  dockId: string;
  questions: ClarifyingQuestion[];
  answers: Answers;
  register: (entry: ChainActionEntry) => void;
  setAnswers: Dispatch<SetStateAction<Answers>>;
  dismiss: () => void;
  isPending?: boolean;
  submit?: (answers: Answers, context: string) => Promise<void>;
  renderRecipient?: (question: ClarifyingQuestion) => ReactNode;
}

/** The questions card's entry in the tool chain. An answer re-registers the
 *  entry in the same event as the keystroke: left to the asking component's
 *  effect, the field would get its value one render late, and React writing
 *  the old value back in between moves the caret to the end and cancels an
 *  IME composition (Japanese "nihongo" came out as "nいhおnngお"). */
export function buildQuestionsEntry(
  args: QuestionsEntryArgs,
): ChainActionEntry {
  const { dockId, questions, answers, register, setAnswers, dismiss } = args;
  const humanQuestions = questions.filter(questionNeedsHumanAnswer);
  const ready =
    !args.isPending &&
    humanQuestions.length > 0 &&
    humanQuestions.every((q) => isAnswered(answers[q.keyword]));
  return {
    id: dockId,
    ready,
    // Answers are ready on the first character of the last one; the user
    // reviews them through the dock's own action, not an automatic send.
    manualProceed: true,
    buildMessage: () =>
      ready ? buildAnswersMessage(questions, answers) : null,
    onSent: dismiss,
    submit: args.submit
      ? (context) => args.submit!(answers, context)
      : undefined,
    questions: {
      id: dockId,
      questions,
      renderRecipient: args.renderRecipient,
      answers,
      onAnswer: (keyword, value) => {
        // State takes the functional update so a second answer in the same
        // event can't drop the first; the entry registered here is what the
        // field shows this render, and the effect re-registers from state.
        setAnswers((prev) => ({ ...prev, [keyword]: value }));
        register(
          buildQuestionsEntry({
            ...args,
            answers: { ...answers, [keyword]: value },
          }),
        );
      },
      onSkip: dismiss,
    },
  };
}
