import {
  commandWorkspaceTask,
  listWorkspaceTasks,
  getListWorkspaceTasksQueryKey,
} from "@/app/api/__generated__/endpoints/tasks/tasks";
import { okData } from "@/app/api/helpers";
import { useQueryClient } from "@tanstack/react-query";

export function useTaskQuestionAnswer() {
  const cache = useQueryClient();
  async function answer(
    taskID: string,
    questionID: string,
    answers: Record<string, string>,
  ) {
    const data = okData(await listWorkspaceTasks());
    const task = data?.tasks.find((task) => task.id === taskID);
    if (!task || task.question?.id !== questionID || task.question.answers)
      throw new Error(
        "This question is no longer waiting for an answer. Refresh the conversation.",
      );
    const response = await commandWorkspaceTask(taskID, {
      operation: "answer",
      version: task.version ?? 1,
      question_id: questionID,
      answers,
    });
    if (!okData(response))
      throw new Error("Could not submit the answer. Please try again.");
    await cache.invalidateQueries({
      queryKey: getListWorkspaceTasksQueryKey(),
    });
    await cache.invalidateQueries({
      predicate: (query) =>
        query.queryKey.some(
          (part) => typeof part === "string" && part.includes("/sessions/"),
        ),
    });
  }
  return answer;
}
