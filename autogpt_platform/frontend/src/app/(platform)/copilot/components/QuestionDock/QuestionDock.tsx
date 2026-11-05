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
import {
  ChainActionsContext,
  type ChainActionEntry,
} from "../ToolChain/chainActions";
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
import { Text } from "@/components/atoms/Text/Text";

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
  const owner = useId();

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
    function register(entry: ChainActionEntry) {
      chainActions?.register(owner, entry);
    }
    register(
      buildQuestionsEntry({
        dockId,
        questions,
        answers,
        register,
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
    return () => chainActions.unregister(owner);
  }, [
    chainActions,
    dismissed,
    dockId,
    owner,
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
    <div
      // oxlint-disable-next-line design-system/no-arbitrary-values -- the floating card lift shadow; no shadow token has it
      className="animate-fade-up rounded-2xl bg-surface p-3 shadow-[0_16px_40px_-24px_rgba(0,0,0,0.25)] ring-1 ring-border-base/70 motion-reduce:animate-none"
    >
      <div className="flex items-center justify-between px-0.5 pb-2">
        <Text variant="small-medium-tight" as="span" tone="muted">
          {questions.length === 1 ? "Quick question" : "Quick questions"}
        </Text>
        <button
          type="button"
          onClick={() => setDismissedId(dockId)}
          className="rounded-full px-2 py-0.5 text-caption text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground-secondary"
        >
          Skip
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {questions.map((q) => (
          <div key={q.keyword} className="flex flex-col gap-1">
            <span
              id={`${formId}-${q.keyword}`}
              className="text-body-sm leading-inherit text-foreground-body"
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
                  className="rounded-xl bg-surface-muted px-2.5 py-1.5 text-body-sm leading-inherit text-foreground-emphasis ring-1 ring-border-base/70 transition-shadow placeholder:text-foreground-subtle focus:ring-foreground-subtle focus:outline-none"
                />
              )
            ) : null}
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive mt-2">
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
            className="rounded-full bg-action-hover px-3.5 py-1.5 text-caption font-medium text-action-foreground transition-opacity hover:bg-action aria-disabled:opacity-40"
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
