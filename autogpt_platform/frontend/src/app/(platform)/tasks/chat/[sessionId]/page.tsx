"use client";

import { ErrorCard } from "@/components/molecules/ErrorCard/ErrorCard";
import { useTaskChatPage } from "./useTaskChatPage";

export default function TaskChatPage() {
  const query = useTaskChatPage();
  return (
    <main className="p-8">
      {query.isError ? (
        <ErrorCard
          context="conversation"
          httpError={{ message: "This conversation is not available." }}
          onRetry={() => query.refetch()}
        />
      ) : (
        <p role="status">Opening conversation…</p>
      )}
    </main>
  );
}
