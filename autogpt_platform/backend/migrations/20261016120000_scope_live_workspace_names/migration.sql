DROP INDEX IF EXISTS "UserWorkspaceFile_workspaceId_path_key";
DROP INDEX IF EXISTS "UserWorkspaceFile_workspaceId_path_live_key";
DROP INDEX IF EXISTS "UserWorkspaceFile_workspaceId_scopeKey_path_key";
DROP INDEX IF EXISTS "UserWorkspaceFolder_workspaceId_parentId_name_key";
DROP INDEX IF EXISTS "UserWorkspaceFolder_workspaceId_parentId_name_live_key";
DROP INDEX IF EXISTS "UserWorkspaceFolder_workspaceId_scopeKey_parentId_name_key";
DROP INDEX IF EXISTS "UserWorkspaceFolder_workspaceId_name_root_key";

CREATE UNIQUE INDEX IF NOT EXISTS "UserWorkspaceFile_workspace_scope_path_live_key"
ON "UserWorkspaceFile" ("workspaceId", "scopeKey", "path")
WHERE "isDeleted" = false;

CREATE UNIQUE INDEX IF NOT EXISTS "UserWorkspaceFolder_workspace_scope_parent_name_live_key"
ON "UserWorkspaceFolder" ("workspaceId", "scopeKey", "parentId", "name")
WHERE "isDeleted" = false;

CREATE UNIQUE INDEX IF NOT EXISTS "UserWorkspaceFolder_workspace_scope_root_name_key"
ON "UserWorkspaceFolder" ("workspaceId", "scopeKey", "name")
WHERE "parentId" IS NULL AND "isDeleted" = false;
