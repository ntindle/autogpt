CREATE TABLE "WorkspaceTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sessionId" TEXT,
    "dispatchState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkspaceTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkspaceTask_sessionId_key" ON "WorkspaceTask"("sessionId");
CREATE INDEX "WorkspaceTask_userId_createdAt_idx" ON "WorkspaceTask"("userId", "createdAt");
CREATE INDEX "WorkspaceTask_dispatchState_updatedAt_idx" ON "WorkspaceTask"("dispatchState", "updatedAt");
CREATE UNIQUE INDEX "WorkspaceTask_id_userId_key" ON "WorkspaceTask"("id", "userId");
