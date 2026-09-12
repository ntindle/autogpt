import { useState } from "react";
import { ArrowUp, Spinner } from "@phosphor-icons/react";
import { isKey } from "@/lib/keyboard";

interface Props {
  disabled: boolean;
  pending: boolean;
  guidance: string;
  onSend: (message: string) => Promise<boolean>;
}

export function BreakdownConversation({
  disabled,
  pending,
  guidance,
  onSend,
}: Props) {
  const [draft, setDraft] = useState("");
  const remaining = Math.max(0, 2000 - guidance.length - (guidance ? 2 : 0));
  async function send() {
    if (disabled || pending || !draft.trim()) return;
    if (await onSend(draft.trim())) setDraft("");
  }
  return (
    <div className="space-y-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2.5 focus-within:ring-1 focus-within:ring-ring"
      >
        <textarea
          aria-label="Refine the breakdown"
          placeholder="Add context or tell AutoPilot what to change…"
          value={draft}
          maxLength={remaining}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (isKey(event, "Enter") && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          className="min-w-0 flex-1 resize-y bg-transparent p-1 text-sm placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          type="submit"
          disabled={disabled || pending || !draft.trim()}
          aria-label="Send refinement"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-700 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {pending ? (
            <Spinner size={17} className="animate-spin" />
          ) : (
            <ArrowUp size={17} weight="bold" />
          )}
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {["Make the steps smaller", "Keep physical work with me"].map(
          (prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={pending || disabled || prompt.length > remaining}
              onClick={() => setDraft(prompt)}
              className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              {prompt}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
