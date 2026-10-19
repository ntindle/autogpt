import { useEffect, useRef } from "react";
import { registerChatSender } from "../../helpers/sendToChat";
import { useOpenUIScope } from "../../tools/RenderUI/OpenUIScopeContext";

interface Props {
  sessionId: string;
  onSend: (message: string) => void | Promise<void>;
}

/** Lets views outside the chat column (side panel, Files page) send to this
 *  chat. Mounted once the chat has loaded. */
export function ChatSenderRegistration({ sessionId, onSend }: Props) {
  const { ownerId, organizationId, teamId } = useOpenUIScope();
  const latest = useRef(onSend);
  latest.current = onSend;
  useEffect(
    () =>
      registerChatSender(sessionId, (text) => latest.current(text), {
        ownerId,
        organizationId,
        teamId,
      }),
    [sessionId, ownerId, organizationId, teamId],
  );
  return null;
}
