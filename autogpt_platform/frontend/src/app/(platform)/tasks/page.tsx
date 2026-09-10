"use client";

import { Skeleton } from "@/components/atoms/Skeleton/Skeleton";
import { ErrorCard } from "@/components/molecules/ErrorCard/ErrorCard";
import { TaskCapture } from "./components/TaskCapture";
import { TaskDetails } from "./components/TaskDetails";
import { TaskSchedules } from "./components/TaskSchedules";
import { TaskList } from "./components/TaskList";
import { TasksHeader } from "./components/TasksHeader";
import { useTasksPage } from "./useTasksPage";

export default function TasksPage() {
  const page = useTasksPage();
  if (page.query.isLoading)
    return (
      <main className="space-y-6 p-8">
        <Skeleton className="h-10 w-32" />
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </main>
    );
  if (page.query.isError)
    return (
      <main className="p-8">
        <ErrorCard
          context="tasks"
          httpError={{ message: "Your tasks could not be loaded" }}
          onRetry={() => page.query.refetch()}
        />
      </main>
    );
  return (
    <main className="flex h-[calc(100dvh-3.5rem)] min-h-[30rem] flex-col bg-background md:h-[calc(100dvh-1rem)]">
      <TasksHeader page={page} />
      {page.view.filter === "Scheduled" ? (
        <TaskSchedules />
      ) : (
        <TaskList page={page} />
      )}
      <TaskCapture page={page} />
      <TaskDetails
        task={page.tasks.find((task) => task.id === page.view.selected)}
        page={page}
      />
    </main>
  );
}
