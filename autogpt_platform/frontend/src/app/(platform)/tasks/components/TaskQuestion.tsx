import { ClarificationQuestionsCard } from "@/app/(platform)/copilot/components/ClarificationQuestionsCard/ClarificationQuestionsCard";
import type { TaskCommand } from "@/app/api/__generated__/models/taskCommand";
import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import { TaskQuestionRecipient } from "./TaskQuestionRecipient";
import type { Task } from "../helpers";

interface Props {
  task: Task;
  tasks: Task[];
  assignees: TaskAssignee[];
  onCommand: (command: Omit<TaskCommand, "version">) => Promise<unknown>;
}

export function TaskQuestion({ task, tasks, assignees, onCommand }: Props) {
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
    <section className="space-y-2" aria-label="Task questions">
      <ClarificationQuestionsCard
        key={question.id}
        sessionId={`${task.id}:${question.id}`}
        questions={question.questions}
        message="Each question goes to the person who can answer it. Replies return to the task automatically."
        renderRecipient={(item) => (
          <TaskQuestionRecipient
            question={item}
            owner={task.assignee}
            tasks={tasks}
            assignees={assignees}
            onRoute={(keyword, target) =>
              onCommand({
                operation: "route_question",
                question_id: question.id,
                question_keyword: keyword,
                question_target: target,
              })
            }
          />
        )}
        onSubmitAnswers={answer}
      />
    </section>
  );
}
