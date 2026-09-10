import { ClarificationQuestionsCard } from "@/app/(platform)/copilot/components/ClarificationQuestionsCard/ClarificationQuestionsCard";
import type { TaskCommand } from "@/app/api/__generated__/models/taskCommand";
import type { Task } from "../helpers";

interface Props {
  task: Task;
  onCommand: (command: Omit<TaskCommand, "version">) => Promise<unknown>;
}

export function TaskQuestion({ task, onCommand }: Props) {
  const question = task.question;
  if (!question || question.answers) return null;
  async function answer(answers: Record<string, string>) {
    await onCommand({
      operation: "answer",
      question_id: question?.id,
      answers,
    });
  }

  return (
    <section className="space-y-2" aria-label="Question awaiting your answer">
      <ClarificationQuestionsCard
        key={question.id}
        sessionId={`${task.id}:${question.id}`}
        questions={question.questions}
        message="Answer here to continue the linked work."
        onSubmitAnswers={answer}
      />
    </section>
  );
}
