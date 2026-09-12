import type { ToolUIPart, UIDataTypes, UIMessage, UITools } from "ai";
import {
  type ClarifyingQuestion,
  extractClarifyingQuestions,
  normalizeClarifyingQuestions,
} from "../../tools/clarifying-questions";

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
  answers: Record<string, string>,
): string {
  const body = questions
    .map((q) => `> ${q.question}\n\n${answers[q.keyword].trim()}`)
    .join("\n\n");
  return `**Here are my answers:**\n\n${body}\n\nPlease proceed.`;
}
