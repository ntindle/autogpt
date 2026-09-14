"use client";

import { useId, type ReactNode } from "react";
import { Input } from "@/components/atoms/Input/Input";
import { Text } from "@/components/atoms/Text/Text";
import { Icon } from "@/components/atoms/Icon/Icon";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { QuestionAnswerField } from "../ChainActionCard/QuestionAnswerField";
import {
  questionNeedsHumanAnswer,
  type ClarifyingQuestion,
} from "../../tools/clarifying-questions";

interface Props {
  question: ClarifyingQuestion;
  index: number;
  value: string;
  recipient?: ReactNode;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function ClarificationQuestion({
  question,
  index,
  value,
  recipient,
  onChange,
  onSubmit,
}: Props) {
  const labelID = useId();
  const needsAnswer = questionNeedsHumanAnswer(question);
  const hasAnswer = !!question.answer || (needsAnswer && !!value.trim());
  return (
    <div
      className={cn(
        "relative rounded-lg border border-dotted p-3",
        hasAnswer
          ? "border-green-500 bg-green-50/50"
          : "border-slate-100 bg-slate-50/50",
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        {hasAnswer ? (
          <Icon
            icon={CheckmarkCircle02Icon}
            size={20}
            className="mt-0.5 text-green-500"
          />
        ) : (
          <div className="mt-0 flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 font-mono">
            {index + 1}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Text
            variant="h5"
            id={labelID}
            className="mb-2 font-semibold text-slate-900"
          >
            {question.question}
          </Text>
          {question.example && !question.options?.length && (
            <Text variant="body" className="mb-2 italic text-slate-500">
              Example: {question.example}
            </Text>
          )}
          {recipient}
          {needsAnswer && question.options?.length ? (
            <QuestionAnswerField
              question={question}
              value={value}
              labelId={labelID}
              autoFocus={false}
              onChange={onChange}
              onPick={onChange}
              onSubmit={onSubmit}
            />
          ) : needsAnswer ? (
            <Input
              type="textarea"
              id={`${labelID}-answer`}
              label={question.question}
              hideLabel
              placeholder="Your answer..."
              rows={2}
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
