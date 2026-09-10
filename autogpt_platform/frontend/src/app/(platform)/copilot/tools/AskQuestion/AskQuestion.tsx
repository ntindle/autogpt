"use client";
import { useTaskQuestionAnswer } from "./useTaskQuestionAnswer";
import type { ToolUIPart } from "ai";
import { ClarificationQuestionsCard } from "../../components/ClarificationQuestionsCard/ClarificationQuestionsCard";
import { useCopilotChatActions } from "../../components/CopilotChatActionsProvider/useCopilotChatActions";
import { MorphingTextAnimation } from "../../components/MorphingTextAnimation/MorphingTextAnimation";
import { normalizeClarifyingQuestions } from "../clarifying-questions";
import {
  getAnimationText,
  getAskQuestionOutput,
  isClarificationOutput,
  isErrorOutput,
} from "./helpers";
import { AlertCircleIcon, Chatting01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/atoms/Icon/Icon";

interface Props {
  part: ToolUIPart;
}

export function AskQuestionTool({ part }: Props) {
  const text = getAnimationText(part);
  const { onSend } = useCopilotChatActions();
  const answerTaskQuestion = useTaskQuestionAnswer();

  const isStreaming =
    part.state === "input-streaming" || part.state === "input-available";
  const isError = part.state === "output-error";

  const output = getAskQuestionOutput(part);

  async function handleAnswers(answers: Record<string, string>) {
    if (!output || !isClarificationOutput(output)) return;
    if (output.task_id && output.task_question_id) {
      await answerTaskQuestion(
        output.task_id,
        output.task_question_id,
        answers,
      );
      return;
    }
    const questions = normalizeClarifyingQuestions(output.questions ?? []);
    const message = questions
      .map((q) => {
        const answer = answers[q.keyword] || "";
        return `> ${q.question}\n\n${answer}`;
      })
      .join("\n\n");
    await onSend(`**Here are my answers:**\n\n${message}\n\nPlease proceed.`);
  }

  if (output && isClarificationOutput(output)) {
    return (
      <ClarificationQuestionsCard
        questions={normalizeClarifyingQuestions(output.questions ?? [])}
        message={output.message}
        sessionId={output.session_id}
        onSubmitAnswers={handleAnswers}
      />
    );
  }

  return (
    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
      {isError || (output && isErrorOutput(output)) ? (
        <Icon icon={AlertCircleIcon} size={16} className="text-red-500" />
      ) : isStreaming ? (
        <Icon icon={Chatting01Icon} size={16} className="animate-pulse" />
      ) : (
        <Icon icon={Chatting01Icon} size={16} />
      )}
      <MorphingTextAnimation
        text={text}
        className={isError ? "text-red-500" : undefined}
      />
    </div>
  );
}
