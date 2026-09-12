import {
  commandWorkspaceTask,
  listWorkspaceTasks,
} from "@/app/api/__generated__/endpoints/tasks/tasks";
import { invalidateTaskSurfaces } from "@/lib/taskSync";
import { okData } from "@/app/api/helpers";
import { useQueryClient } from "@tanstack/react-query";

export function useTaskQuestionAnswer() {
  const cache = useQueryClient();
  async function answer(
    taskID: string,
    questionID: string,
    answers: Record<string, string>,
    feedback = "",
  ) {
    const data = okData(await listWorkspaceTasks());
    const task =
      data?.tasks.find(
        (task) => task.id === taskID && task.question?.id === questionID,
      ) ?? data?.tasks.find((task) => task.question?.id === questionID);
    if (!task || task.question?.id !== questionID || task.question.answers)
      throw new Error(
        "This question is no longer waiting for an answer. Refresh the conversation.",
      );
    const response = await commandWorkspaceTask(task.id ?? taskID, {
      operation: "answer",
      version: task.version ?? 1,
      question_id: questionID,
      answers,
      feedback,
    });
    if (!okData(response))
      throw new Error("Could not submit the answer. Please try again.");
    await invalidateTaskSurfaces(cache);
    await cache.invalidateQueries({
      predicate: (query) =>
        query.queryKey.some(
          (part) => typeof part === "string" && part.includes("/sessions/"),
        ),
    });
  }
  return answer;
}
