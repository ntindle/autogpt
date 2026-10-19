import { toast } from "@/components/molecules/Toast/use-toast";
import { openUIScopeKey, type OpenUIScope } from "../tools/RenderUI/scope";

type ChatSender = (text: string) => void | Promise<void>;

interface QueuedMessage {
  text: string;
  resolve: () => void;
  reject: (cause: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const SEND_TO_CHAT_TIMEOUT_MS = 15_000;

const senders = new Map<string, ChatSender>();
const pending = new Map<string, QueuedMessage[]>();

export function chatHref(sessionId: string, scope: OpenUIScope = {}) {
  const params = new URLSearchParams({ sessionId });
  if (scope.organizationId !== undefined) {
    params.set("organizationId", scope.organizationId ?? "__personal__");
    params.set("teamId", scope.teamId ?? "__org_home__");
  }
  return `/copilot?${params.toString()}`;
}

/**
 * Sends `text` to the chat `sessionId` through that chat's own send path
 * (so a running turn queues it as usual). When the chat is not on screen the
 * message waits here until its host mounts and registers. The promise settles
 * once the chat has taken the message, or rejects if it fails or the chat
 * does not appear in time.
 */
export function sendToChat(
  sessionId: string,
  text: string,
  scope: OpenUIScope = {},
) {
  const destination = JSON.stringify([sessionId, openUIScopeKey(scope)]);
  const sender = senders.get(destination);
  if (sender) return deliver(sender, text);
  return new Promise<void>((resolve, reject) => {
    const message: QueuedMessage = {
      text,
      resolve,
      reject,
      timer: setTimeout(() => {
        dequeue(destination, message);
        fail(message, new Error("The chat didn't open in time."));
      }, SEND_TO_CHAT_TIMEOUT_MS),
    };
    pending.set(destination, [...(pending.get(destination) ?? []), message]);
  });
}

export function registerChatSender(
  sessionId: string,
  sender: ChatSender,
  scope: OpenUIScope = {},
) {
  const destination = JSON.stringify([sessionId, openUIScopeKey(scope)]);
  senders.set(destination, sender);
  const queued = pending.get(destination) ?? [];
  pending.delete(destination);
  for (const message of queued) {
    clearTimeout(message.timer);
    deliver(sender, message.text).then(message.resolve, (cause) =>
      fail(message, cause),
    );
  }
  return () => {
    if (senders.get(destination) === sender) senders.delete(destination);
  };
}

function deliver(sender: ChatSender, text: string) {
  return new Promise<void>((resolve) => resolve(sender(text)));
}

function dequeue(sessionId: string, message: QueuedMessage) {
  const rest = (pending.get(sessionId) ?? []).filter(
    (entry) => entry !== message,
  );
  if (rest.length) pending.set(sessionId, rest);
  else pending.delete(sessionId);
}

// The view that queued the message usually unmounts once the user is taken
// to the chat, so a toast reports the failure there as well.
function fail(message: QueuedMessage, cause: unknown) {
  toast({
    title: "Couldn't send message",
    description: "Try submitting the view again.",
    variant: "destructive",
  });
  message.reject(cause);
}
