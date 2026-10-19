"use client";

import type { UIDataTypes, UIMessage, UITools } from "ai";
import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  isAnswered,
  toAnswerText,
  toMultiAnswer,
  type QuestionAnswer,
} from "../../tools/clarifying-questions";
import { QuestionMultiAnswerField } from "../ChainActionCard/QuestionMultiAnswerField";
import { CopilotChatActionsContext } from "../CopilotChatActionsProvider/useCopilotChatActions";
import { ChainActionsContext } from "../ToolChain/chainActions";
import {
  buildAnswersMessage,
  buildQuestionsEntry,
  getPendingQuestions,
  type PendingQuestions,
} from "./helpers";
import { TaskQuestionsForm } from "./TaskQuestionsForm";
import type { TaskQuestionBinding } from "./helpers";
import {
  questionNeedsHumanAnswer,
  type ClarifyingQuestion,
} from "../../tools/clarifying-questions";
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
  isPending?: boolean;
  renderRecipient?: (question: ClarifyingQuestion) => ReactNode;
  onAnswer?: (
    answers: Record<string, QuestionAnswer>,
    context: string,
  ) => Promise<void>;
}

export function QuestionAnswerForm({
  dockId,
  questions,
  onAnswer,
  renderRecipient,
  isPending = false,
}: AnswerProps) {
  const actions = useContext(CopilotChatActionsContext);
  const chainActions = useContext(ChainActionsContext);
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({});
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [renderedDockId, setRenderedDockId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, { focus: () => void } | null>>({});
  const formId = useId();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submissionRef = useRef(false);
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;
  const recipientRef = useRef(renderRecipient);
  recipientRef.current = renderRecipient;
  const hasRecipients = Boolean(renderRecipient);
  const taskLinked = Boolean(onAnswer);
  const dismissed = dockId === dismissedId;
  const humanQuestions = questions.filter(questionNeedsHumanAnswer);
  const allAnswered =
    !isPending &&
    humanQuestions.length > 0 &&
    humanQuestions.every((q) => isAnswered(answers[q.keyword]));

  // Inside a tool chain the Answer button is replaced by the chain's single
  // Proceed step — register readiness + message instead.
  useEffect(() => {
    if (!chainActions || dismissed) return;
    chainActions.register(
      buildQuestionsEntry({
        dockId,
        questions,
        answers,
        register: chainActions.register,
        setAnswers,
        dismiss: () => setDismissedId(dockId),
        isPending,
        submit: taskLinked
          ? (values, context) => onAnswerRef.current!(values, context)
          : undefined,
        renderRecipient: hasRecipients
          ? (question) => recipientRef.current?.(question)
          : undefined,
      }),
    );
    return () => chainActions.unregister(dockId);
  }, [
    chainActions,
    dismissed,
    dockId,
    answers,
    questions,
    isPending,
    taskLinked,
    hasRecipients,
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
      const unanswered = humanQuestions.find(
        (q) => !isAnswered(answers[q.keyword]),
      );
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
          <div key={q.keyword} className="flex flex-col gap-1">
            <span
              id={`${formId}-${q.keyword}`}
              className="text-[13px] text-zinc-700"
            >
              {q.question}
            </span>
            {renderRecipient?.(q)}
            {questionNeedsHumanAnswer(q) ? (
              q.allow_multiple && q.options?.length ? (
                <QuestionMultiAnswerField
                  ref={(element) => {
                    inputRefs.current[q.keyword] = element;
                  }}
                  options={q.options}
                  value={toMultiAnswer(answers[q.keyword])}
                  labelId={`${formId}-${q.keyword}`}
                  autoFocus={false}
                  onChange={(value) =>
                    setAnswers((prev) => ({ ...prev, [q.keyword]: value }))
                  }
                  onSubmit={handleSubmit}
                />
              ) : (
                <input
                  ref={(element) => {
                    inputRefs.current[q.keyword] = element;
                  }}
                  type="text"
                  aria-label={q.question}
                  required
                  value={toAnswerText(answers[q.keyword])}
                  onChange={(e) =>
                    setAnswers((prev) => ({
                      ...prev,
                      [q.keyword]: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (isKey(e, "Enter")) handleSubmit();
                  }}
                  placeholder={
                    q.example ? `e.g. ${q.example}` : "Type your answer"
                  }
                  className="rounded-xl bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-800 ring-1 ring-zinc-200/70 transition-shadow placeholder:text-zinc-400 focus:outline-none focus:ring-zinc-400"
                />
              )
            ) : null}
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {!chainActions && humanQuestions.length > 0 && (
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
