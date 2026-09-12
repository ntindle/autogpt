import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetV2GetSessionQueryKey } from "@/app/api/__generated__/endpoints/chat/chat";
import { useListWorkspaceTasks } from "@/app/api/__generated__/endpoints/tasks/tasks";
import { okData } from "@/app/api/helpers";
import { useTaskQuestionAnswer } from "../../tools/AskQuestion/useTaskQuestionAnswer";
import { QuestionAnswerForm } from "./QuestionDock";
import type { PendingQuestions, TaskQuestionBinding } from "./helpers";

interface Props {
  dockId: string;
  questions: PendingQuestions["questions"];
  taskBinding: TaskQuestionBinding;
}

export function TaskQuestionsForm({ dockId, questions, taskBinding }: Props) {
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
  return (
    <QuestionAnswerForm
      dockId={dockId}
      questions={questions}
      onAnswer={submit}
    />
  );
}
