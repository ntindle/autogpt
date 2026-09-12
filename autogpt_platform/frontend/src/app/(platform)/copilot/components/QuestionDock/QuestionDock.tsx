"use client";

import type { UIDataTypes, UIMessage, UITools } from "ai";
import { useContext, useEffect, useRef, useState } from "react";
import { CopilotChatActionsContext } from "../CopilotChatActionsProvider/useCopilotChatActions";
import { ChainActionsContext } from "../ToolChain/chainActions";
import {
  buildAnswersMessage,
  getPendingQuestions,
  type PendingQuestions,
} from "./helpers";
import { TaskQuestionsForm } from "./TaskQuestionsForm";
import type { TaskQuestionBinding } from "./helpers";
import { isKey } from "@/lib/keyboard";

interface FormProps {
  dockId: string;
  questions: PendingQuestions["questions"];
  taskBinding?: TaskQuestionBinding;
}

/** The clarifying-question answer form — rendered inline in the tool chain
 *  on the ask_question row (and reused by the legacy QuestionDock). */
export function QuestionsForm({ taskBinding, ...props }: FormProps) {
  return taskBinding ? (
    <TaskQuestionsForm {...props} taskBinding={taskBinding} />
  ) : (
    <QuestionAnswerForm {...props} />
  );
}

interface AnswerProps extends FormProps {
  onAnswer?: (
    answers: Record<string, string>,
    context: string,
  ) => Promise<void>;
}

export function QuestionAnswerForm({
  dockId,
  questions,
  onAnswer,
}: AnswerProps) {
  const actions = useContext(CopilotChatActionsContext);
  const chainActions = useContext(ChainActionsContext);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [renderedDockId, setRenderedDockId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submissionRef = useRef(false);
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;
  const taskLinked = Boolean(onAnswer);
  const dismissed = dockId === dismissedId;
  const allAnswered = questions.every((q) => answers[q.keyword]?.trim());

  // Inside a tool chain the Answer button is replaced by the chain's single
  // Proceed step — register readiness + message instead.
  useEffect(() => {
    if (!chainActions || dismissed) return;
    chainActions.register({
      id: dockId,
      ready: allAnswered,
      // Answers are ready on the first character of the last one; the user
      // reviews them through the dock's own action, not an automatic send.
      manualProceed: true,
      buildMessage: () =>
        allAnswered ? buildAnswersMessage(questions, answers) : null,
      onSent: () => setDismissedId(dockId),
      submit: taskLinked
        ? (context) => onAnswerRef.current!(answers, context)
        : undefined,
      questions: {
        id: dockId,
        questions,
        answers,
        onAnswer: (keyword, value) =>
          setAnswers((prev) => ({ ...prev, [keyword]: value })),
        onSkip: () => setDismissedId(dockId),
      },
    });
    return () => chainActions.unregister(dockId);
  }, [
    chainActions,
    dismissed,
    dockId,
    allAnswered,
    answers,
    questions,
    taskLinked,
  ]);

  if (renderedDockId !== dockId) {
    setRenderedDockId(dockId);
    setAnswers({});
  }

  if (!actions || dismissed) return null;
  // Inside a chain the inputs live in the action card below it, not on the
  // row that asked.
  if (chainActions) return null;

  async function handleSubmit() {
    if (submissionRef.current) return;
    if (chainActions) return;
    if (!actions) return;
    if (!allAnswered) {
      const unanswered = questions.find((q) => !answers[q.keyword]?.trim());
      if (unanswered) inputRefs.current[unanswered.keyword]?.focus();
      return;
    }
    submissionRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (onAnswer) await onAnswer(answers, "");
      else await actions.onSend(buildAnswersMessage(questions, answers));
      setDismissedId(dockId);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not submit your answers. Try again.",
      );
    } finally {
      submissionRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-fade-up rounded-2xl bg-white p-3 shadow-[0_16px_40px_-24px_rgba(0,0,0,0.25)] ring-1 ring-zinc-200/70 motion-reduce:animate-none">
      <div className="flex items-center justify-between px-0.5 pb-2">
        <span className="text-xs font-medium text-zinc-500">
          {questions.length === 1 ? "Quick question" : "Quick questions"}
        </span>
        <button
          type="button"
          onClick={() => setDismissedId(dockId)}
          className="rounded-full px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
        >
          Skip
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {questions.map((q) => (
          <label key={q.keyword} className="flex flex-col gap-1">
            <span className="text-[13px] text-zinc-700">{q.question}</span>
            <input
              ref={(element) => {
                inputRefs.current[q.keyword] = element;
              }}
              type="text"
              required
              value={answers[q.keyword] ?? ""}
              onChange={(e) =>
                setAnswers((prev) => ({
                  ...prev,
                  [q.keyword]: e.target.value,
                }))
              }
              onKeyDown={(e) => {
                if (isKey(e, "Enter")) handleSubmit();
              }}
              placeholder={q.example ? `e.g. ${q.example}` : "Type your answer"}
              className="rounded-xl bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-800 ring-1 ring-zinc-200/70 transition-shadow placeholder:text-zinc-400 focus:outline-none focus:ring-zinc-400"
            />
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {!chainActions && (
        <div className="flex justify-end pt-2.5">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            aria-disabled={!allAnswered || submitting}
            className="rounded-full bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white transition-opacity aria-disabled:opacity-40 hover:bg-zinc-700"
          >
            {submitting
              ? "Submitting…"
              : onAnswer
                ? "Submit answers"
                : "Answer"}
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  messages: UIMessage<unknown, UIDataTypes, UITools>[];
}

export function QuestionDock({ messages }: Props) {
  const pending = getPendingQuestions(messages);
  if (!pending) return null;
  return (
    <div className="mb-2">
      <QuestionsForm
        key={pending.dockId}
        dockId={pending.dockId}
        questions={pending.questions}
        taskBinding={pending.taskBinding}
      />
    </div>
  );
}
