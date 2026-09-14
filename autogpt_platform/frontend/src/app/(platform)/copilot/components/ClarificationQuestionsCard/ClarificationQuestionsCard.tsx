"use client";

import { Button } from "@/components/atoms/Button/Button";
import { Card } from "@/components/atoms/Card/Card";
import { ClarificationQuestion } from "./ClarificationQuestion";
import { Text } from "@/components/atoms/Text/Text";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  questionNeedsHumanAnswer,
  type ClarifyingQuestion,
} from "../../tools/clarifying-questions";
import {
  Chatting01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/atoms/Icon/Icon";

interface Props {
  questions: ClarifyingQuestion[];
  renderRecipient?: (question: ClarifyingQuestion) => ReactNode;
  message: string;
  sessionId?: string;
  onSubmitAnswers: (answers: Record<string, string>) => void | Promise<void>;
  onCancel?: () => void;
  isAnswered?: boolean;
  className?: string;
}

export function ClarificationQuestionsCard({
  questions,
  renderRecipient,
  message,
  sessionId,
  onSubmitAnswers,
  onCancel,
  isAnswered = false,
  className,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const lastSessionIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const storageKey = getStorageKey(sessionId);
    if (!storageKey) {
      setAnswers({});
      setIsSubmitted(false);
      lastSessionIdRef.current = sessionId;
      return;
    }

    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, string>;
        setAnswers(parsed);
      } else {
        setAnswers({});
      }
      setIsSubmitted(false);
    } catch {
      setAnswers({});
      setIsSubmitted(false);
    }
    lastSessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (lastSessionIdRef.current !== sessionId) {
      return;
    }
    const storageKey = getStorageKey(sessionId);
    if (!storageKey) return;

    const hasAnswers = Object.values(answers).some((v) => v.trim());
    try {
      if (hasAnswers) {
        localStorage.setItem(storageKey, JSON.stringify(answers));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {}
  }, [answers, sessionId]);

  function handleAnswerChange(keyword: string, value: string) {
    setAnswers((prev) => ({ ...prev, [keyword]: value }));
  }

  const humanQuestions = questions.filter(questionNeedsHumanAnswer);
  const waitingForTeammate = questions.some(
    (q) => !q.answer && q.target && q.target.kind !== "human",
  );

  async function handleSubmit() {
    if (
      isSubmitting ||
      !humanQuestions.length ||
      !humanQuestions.every((q) => answers[q.keyword]?.trim())
    )
      return;
    setIsSubmitting(true);
    setSubmitError("");
    try {
      await onSubmitAnswers(answers);
      setIsSubmitted(true);
      const storageKey = getStorageKey(sessionId);
      try {
        if (storageKey) localStorage.removeItem(storageKey);
      } catch {}
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Could not submit answers. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const allAnswered =
    humanQuestions.length > 0 &&
    humanQuestions.every((q) => answers[q.keyword]?.trim());

  if (isAnswered || (isSubmitted && !waitingForTeammate)) {
    return (
      <div
        className={cn(
          "group relative flex w-full justify-start gap-3 px-4 py-3",
          className,
        )}
      >
        <div className="flex w-full max-w-3xl gap-3">
          <div className="flex-shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-500">
              <Icon
                icon={CheckmarkCircle02Icon}
                className="h-4 w-4 text-white"
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <Card className="p-4">
              <Text variant="h4" className="mb-1 text-slate-900">
                Answers submitted
              </Text>
              <Text variant="small" className="text-slate-600">
                Processing your responses...
              </Text>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex w-full justify-start gap-3",
        className,
      )}
    >
      <div className="flex w-full max-w-3xl gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <Card className="space-y-6 p-8">
            <div>
              <div className="flex gap-3">
                <Icon icon={Chatting01Icon} className="size-6" />
                <Text variant="h4" className="mb-1 text-slate-900">
                  I need more information
                </Text>
              </div>
              <Text variant="body" className="text-slate-600">
                {message}
              </Text>
            </div>

            <div className="space-y-6">
              {questions.map((question, index) => (
                <ClarificationQuestion
                  key={`${question.keyword}-${index}`}
                  question={question}
                  index={index}
                  value={answers[question.keyword] || ""}
                  recipient={renderRecipient?.(question)}
                  onChange={(value) =>
                    handleAnswerChange(question.keyword, value)
                  }
                  onSubmit={handleSubmit}
                />
              ))}
            </div>

            {submitError ? (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            ) : null}
            {humanQuestions.length ? (
              <div className="flex max-w-[25rem] gap-2">
                <Button
                  onClick={handleSubmit}
                  disabled={!allAnswered || isSubmitting}
                  className="w-auto flex-1"
                  variant="primary"
                >
                  Submit Answers
                </Button>
                {onCancel && (
                  <Button onClick={onCancel} variant="outline">
                    Cancel
                  </Button>
                )}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

function getStorageKey(sessionId?: string): string | null {
  if (!sessionId) return null;
  return `clarification_answers_${sessionId}`;
}
