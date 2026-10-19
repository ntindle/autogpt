"use client";
import { TaskConversationContext } from "./components/TaskConversationContext/TaskConversationContext";
import { ChatContainer } from "./components/ChatContainer/ChatContainer";
import { ChatSenderRegistration } from "./components/ChatSenderRegistration/ChatSenderRegistration";
import type { FloatingControls } from "./components/ChatMessagesContainer/components/ThreadHeader";
import { ProviderLimitDialog } from "./components/ProviderLimitDialog/ProviderLimitDialog";
import { RateLimitGate } from "./components/RateLimitResetDialog/RateLimitGate";
import { useCopilotPage } from "./useCopilotPage";
import { ConversationOrganization } from "./components/ConversationOrganization/ConversationOrganization";
import { TaskScopeContext } from "@/services/tasks/TaskScopeContext";
import { CopilotTenantScopeProvider } from "./CopilotTenantScopeContext";
import { OpenUIScopeProvider } from "./tools/RenderUI/OpenUIScopeContext";
import { FlaskConicalIcon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/atoms/Icon/Icon";
import { Flag, useGetFlag } from "@/services/feature-flags/use-get-flag";
import { useUsageExperience } from "@/services/usageExperience/useUsageExperience";
import { useRateLimitRefresh } from "./components/RateLimitResetDialog/useRateLimitRefresh";

interface Props {
  droppedFiles: File[];
  onDroppedFilesConsumed: () => void;
  /** Which layout floats its controls over the chat's top-left corner on
   *  small viewports. */
  floatingControls?: FloatingControls;
}

/**
 * Session-scoped chat host. Parent mounts this with `key={sessionId}` so
 * session-local view state resets on switch, while the stream itself is
 * preserved in a per-session runtime registry. Keyed again by the stream
 * flag, so flags resolving after mount swap the stream hook by remounting.
 */
export function CopilotChatHost(props: Props) {
  const isStreamRuntime = useGetFlag(Flag.COPILOT_STREAM_RUNTIME) === true;
  return (
    <ChatHostBody
      key={isStreamRuntime ? "stream-runtime" : "ai-sdk"}
      {...props}
      isStreamRuntime={isStreamRuntime}
    />
  );
}

function ChatHostBody({
  droppedFiles,
  onDroppedFilesConsumed,
  floatingControls,
  isStreamRuntime,
}: Props & { isStreamRuntime: boolean }) {
  const {
    sessionId,
    sessionOrganizationId,
    sessionTeamId,
    messages,
    status,
    error,
    stop,
    isReconnecting,
    isFinishProbing,
    isRestoringActiveSession,
    restoreStatusMessage,
    activeStreamStartedAt,
    isUserStopping,
    createSession,
    onSend,
    onEnqueue,
    queuedMessages,
    isLoadingSession,
    isSessionError,
    isSessionNotFound,
    isCreatingSession,
    isUploadingFiles,
    pendingSend,
    hasMoreMessages,
    isLoadingMore,
    loadMore,
    turnStats,
    rateLimitMessage,
    platformLimitFailure,
    dismissRateLimit,
    providerLimit,
    dismissProviderLimit,
    sessionDryRun,
    sessionWorkspaceTaskId,
    sessionChatStatus,
    sessionSentFrom,
    sessionAutopilotMode,
    chatLlmAuthProvider,
    expertIdentity,
    isResolvingExpertIdentity,
    isAdoptingExpertSession,
    isKickoffStarting,
    createTeamId,
    setCreateTeamId,
    isTeamContextReady,
    canSelectCreateTeam,
    followBackendTurn,
  } = useCopilotPage({ isStreamRuntime });
  const usage = useUsageExperience();
  const usageRefresh = useRateLimitRefresh(rateLimitMessage, usage.retry);
  function dismissAfterProviderChange() {
    usageRefresh.release();
    dismissRateLimit();
  }

  return (
    <CopilotTenantScopeProvider
      organizationId={sessionOrganizationId}
      teamId={sessionTeamId}
    >
      <OpenUIScopeProvider
        organizationId={sessionOrganizationId}
        teamId={sessionTeamId}
      >
        <TaskScopeContext.Provider
          value={{
            organizationId: sessionOrganizationId,
            teamId: sessionTeamId,
            ready: sessionId
              ? !isLoadingSession && !isSessionError
              : isTeamContextReady,
          }}
        >
          <ConversationOrganization organizationId={sessionOrganizationId} />
          {sessionId &&
            !isLoadingSession &&
            !isRestoringActiveSession &&
            !isSessionError &&
            !isSessionNotFound &&
            !isResolvingExpertIdentity &&
            !isAdoptingExpertSession &&
            !isKickoffStarting &&
            !expertIdentity?.isArchived && (
              <ChatSenderRegistration
                key={sessionId}
                sessionId={sessionId}
                onSend={onSend}
              />
            )}
          {/* Only shown when the CURRENT session is confirmed dry_run via its
          immutable metadata. Never based on the global isDryRun preference
          (which only predicts future sessions). */}
          {sessionId && sessionDryRun && (
            <div className="flex items-center justify-center gap-1.5 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
              <Icon icon={FlaskConicalIcon} size={13} />
              Test mode — this session runs workflows as simulation
            </div>
          )}
          {sessionId && sessionWorkspaceTaskId ? (
            <TaskConversationContext sessionId={sessionId} />
          ) : null}
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChatContainer
              isUsageRefused={!!rateLimitMessage || usageRefresh.guarded}
              usageFailure={platformLimitFailure}
              onDismissUsage={dismissAfterProviderChange}
              usageRefresh={usageRefresh}
              usage={usage}
              chatAuthProvider={chatLlmAuthProvider}
              messages={messages}
              status={status}
              error={error}
              sessionId={sessionId}
              sessionOrganizationId={sessionOrganizationId}
              sessionTeamId={sessionTeamId}
              sessionChatStatus={sessionChatStatus}
              sessionSentFrom={sessionSentFrom}
              sessionAutopilotMode={sessionAutopilotMode}
              isLoadingSession={isLoadingSession}
              isSessionError={isSessionError}
              isSessionNotFound={isSessionNotFound}
              isCreatingSession={isCreatingSession}
              isReconnecting={isReconnecting}
              isFinishProbing={isFinishProbing}
              isRestoringActiveSession={isRestoringActiveSession}
              restoreStatusMessage={restoreStatusMessage}
              activeStreamStartedAt={activeStreamStartedAt}
              isUserStopping={isUserStopping}
              onCreateSession={createSession}
              onSend={onSend}
              onStop={stop}
              onEnqueue={onEnqueue}
              queuedMessages={queuedMessages}
              isUploadingFiles={isUploadingFiles}
              pendingSend={pendingSend}
              hasMoreMessages={hasMoreMessages}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMore}
              droppedFiles={droppedFiles}
              onDroppedFilesConsumed={onDroppedFilesConsumed}
              turnStats={turnStats}
              expertIdentity={expertIdentity}
              isResolvingExpertIdentity={isResolvingExpertIdentity}
              isAdoptingExpertSession={isAdoptingExpertSession}
              isKickoffStarting={isKickoffStarting}
              createTeamId={createTeamId}
              onCreateTeamChange={setCreateTeamId}
              isTeamContextReady={isTeamContextReady}
              canSelectCreateTeam={canSelectCreateTeam}
              onBackendTurn={followBackendTurn}
              floatingControls={floatingControls}
            />
          </div>
          <RateLimitGate
            refreshState={usageRefresh}
            rateLimitMessage={rateLimitMessage}
            failure={platformLimitFailure}
            sessionId={sessionId}
            onDismiss={dismissRateLimit}
            onSendNow={onSend}
          />
          <ProviderLimitDialog
            failure={providerLimit}
            sessionId={sessionId}
            onDismiss={dismissProviderLimit}
          />
        </TaskScopeContext.Provider>
      </OpenUIScopeProvider>
    </CopilotTenantScopeProvider>
  );
}
