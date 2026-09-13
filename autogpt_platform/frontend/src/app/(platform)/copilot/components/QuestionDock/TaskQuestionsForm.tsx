import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetV2GetSessionQueryKey } from "@/app/api/__generated__/endpoints/chat/chat";
import {
  commandWorkspaceTask,
  useListWorkspaceTasks,
} from "@/app/api/__generated__/endpoints/tasks/tasks";
import { okData } from "@/app/api/helpers";
import { useTaskQuestionAnswer } from "../../tools/AskQuestion/useTaskQuestionAnswer";
import { QuestionAnswerForm } from "./QuestionDock";
import type { PendingQuestions, TaskQuestionBinding } from "./helpers";
import { TaskQuestionRecipient } from "../../../tasks/components/TaskQuestionRecipient";
import { ClarificationQuestionsCard } from "../ClarificationQuestionsCard/ClarificationQuestionsCard";
import type { ClarifyingQuestion } from "../../tools/clarifying-questions";
import type { TaskAssignee } from "@/app/api/__generated__/models/taskAssignee";
import { invalidateTaskSurfaces } from "@/lib/taskSync";

interface Props {
  dockId: string;
  variant?: "card" | "chain";
  questions: PendingQuestions["questions"];
  taskBinding: TaskQuestionBinding;
}

export function TaskQuestionsForm({
  dockId,
  questions,
  taskBinding,
  variant = "chain",
}: Props) {
  const query = useListWorkspaceTasks({
    query: { select: okData, refetchInterval: 5000 },
  });
  const answer = useTaskQuestionAnswer();
  const cache = useQueryClient();
  const resolvedID = useRef(taskBinding.taskID);
  const matching = query.data?.tasks.find(
    (task) => task.question?.id === taskBinding.questionID,
  );
  if (matching?.id) resolvedID.current = matching.id;
  const task =
    matching ??
    query.data?.tasks.find((task) => task.id === resolvedID.current);
  const sessionID = task?.session_id;
  const version = task?.version;
  const dispatchState = task?.dispatch_state;
  useEffect(() => {
    if (sessionID)
      void cache.invalidateQueries({
        queryKey: getGetV2GetSessionQueryKey(sessionID),
      });
  }, [cache, sessionID, version, dispatchState]);
  if (
    query.data &&
    (!matching ||
      matching.question?.answers ||
      matching.status === "done" ||
      matching.status === "canceled")
  )
    return null;
  async function submit(answers: Record<string, string>, context: string) {
    await answer(
      task?.id ?? taskBinding.taskID,
      taskBinding.questionID,
      answers,
      context,
    );
  }
  async function route(keyword: string, target: TaskAssignee) {
    if (!task?.id || !task.question)
      throw new Error("Refresh the question before redirecting it.");
    const response = await commandWorkspaceTask(task.id, {
      operation: "route_question",
      version: task.version ?? 1,
      question_id: task.question.id,
      question_keyword: keyword,
      question_target: target,
    });
    if (!okData(response))
      throw new Error("Could not redirect the question. Please try again.");
    await invalidateTaskSurfaces(cache);
  }
  function recipient(question: ClarifyingQuestion) {
    return (
      <TaskQuestionRecipient
        question={question}
        owner={task?.assignee}
        tasks={query.data?.tasks ?? []}
        assignees={query.data?.assignees ?? []}
        onRoute={route}
      />
    );
  }
  const currentQuestions = task?.question?.questions ?? questions;
  if (variant === "card")
    return (
      <ClarificationQuestionsCard
        questions={currentQuestions}
        sessionId={dockId}
        message="Replies return to the task automatically."
        renderRecipient={recipient}
        onSubmitAnswers={(answers) => submit(answers, "")}
      />
    );
  return (
    <QuestionAnswerForm
      dockId={dockId}
      questions={currentQuestions}
      renderRecipient={recipient}
      isPending={!query.data || query.isError}
      onAnswer={submit}
    />
  );
}
