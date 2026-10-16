BEGIN;

-- Each organization may hire its own copy of the same template.
DROP INDEX "Expert_ownerUserId_sourceTemplateId_key";
CREATE UNIQUE INDEX "Expert_ownerUserId_organizationId_sourceTemplateId_key"
ON "Expert" ("ownerUserId", "organizationId", "sourceTemplateId");

-- Match the personal-memory anchor: the oldest owned, non-deleted personal org.
-- Membership in someone else's personal org never grants it the owner's data.
UPDATE "Expert" e SET "organizationId" = m."orgId", "teamId" = t."id"
FROM (
    SELECT DISTINCT ON (m."userId") m."userId", m."orgId"
    FROM "OrgMember" m JOIN "Organization" o ON o."id" = m."orgId"
    WHERE m."isOwner" AND o."isPersonal" AND o."deletedAt" IS NULL
    ORDER BY m."userId", m."createdAt", m."id"
) m
JOIN "Team" t ON t."orgId" = m."orgId" AND t."isDefault"
WHERE e."ownerUserId" = m."userId" AND e."organizationId" IS NULL AND NOT e."isTemplate";

-- The regular write trigger deliberately forbids tenant changes. This one-time
-- backfill runs under the table lock in this transaction and restores the guard.
ALTER TABLE "UserWorkspaceFile" DISABLE TRIGGER enforce_workspace_artifact_scope;
UPDATE "UserWorkspaceFile" f
SET "organizationId" = m."orgId", "teamId" = t."id", "isUserGlobalConfig" = false,
    "scopeKey" = m."orgId" || ':' || t."id", "scopeResolved" = true
FROM "UserWorkspace" w JOIN (
    SELECT DISTINCT ON (m."userId") m."userId", m."orgId"
    FROM "OrgMember" m JOIN "Organization" o ON o."id" = m."orgId"
    WHERE m."isOwner" AND o."isPersonal" AND o."deletedAt" IS NULL
    ORDER BY m."userId", m."createdAt", m."id"
) m ON m."userId" = w."userId"
JOIN "Team" t ON t."orgId" = m."orgId" AND t."isDefault"
WHERE f."workspaceId" = w."id" AND f."isUserGlobalConfig"
AND (f."path" LIKE '/skills/%' OR f."path" ~ '^/experts/[^/]+/skills/');

ALTER TABLE "UserWorkspaceFile" ENABLE TRIGGER enforce_workspace_artifact_scope;

ALTER TABLE "SkillLearningSource" ADD COLUMN "organizationId" TEXT;
UPDATE "SkillLearningSource" r SET "organizationId" = m."orgId"
FROM (
    SELECT DISTINCT ON (m."userId") m."userId", m."orgId"
    FROM "OrgMember" m JOIN "Organization" o ON o."id" = m."orgId"
    WHERE m."isOwner" AND o."isPersonal" AND o."deletedAt" IS NULL
    ORDER BY m."userId", m."createdAt", m."id"
) m
WHERE r."userId" = m."userId";
-- Source eligibility stays attached to the saved conversation, including
-- conversations already attributed to a non-personal organization.
UPDATE "SkillLearningSource" r SET "organizationId" = c."organizationId"
FROM "ChatSession" c WHERE r."sourceKind" = 'chat_session'
AND r."sourceId" = c."id" AND r."userId" = c."userId"
AND c."organizationId" IS NOT NULL;
UPDATE "SkillLearningSource" SET "ownerKey" = 'org:' || "organizationId" || ':' || "ownerKey"
WHERE "organizationId" IS NOT NULL;

ALTER TABLE "SkillLearningReview" ADD COLUMN "organizationId" TEXT;
UPDATE "SkillLearningReview" r SET "organizationId" = m."orgId"
FROM (
    SELECT DISTINCT ON (m."userId") m."userId", m."orgId"
    FROM "OrgMember" m JOIN "Organization" o ON o."id" = m."orgId"
    WHERE m."isOwner" AND o."isPersonal" AND o."deletedAt" IS NULL
    ORDER BY m."userId", m."createdAt", m."id"
) m
WHERE r."userId" = m."userId";
UPDATE "SkillLearningReview" r SET "organizationId" = s."organizationId"
FROM "SkillLearningSource" s WHERE r."sourceId" = s."id";
UPDATE "SkillLearningReview" SET "ownerKey" = 'org:' || "organizationId" || ':' || "ownerKey"
WHERE "organizationId" IS NOT NULL;

ALTER TABLE "SkillHead" ADD COLUMN "organizationId" TEXT;
UPDATE "SkillHead" r SET "organizationId" = m."orgId"
FROM (
    SELECT DISTINCT ON (m."userId") m."userId", m."orgId"
    FROM "OrgMember" m JOIN "Organization" o ON o."id" = m."orgId"
    WHERE m."isOwner" AND o."isPersonal" AND o."deletedAt" IS NULL
    ORDER BY m."userId", m."createdAt", m."id"
) m
WHERE r."userId" = m."userId";
UPDATE "SkillHead" SET "ownerKey" = 'org:' || "organizationId" || ':' || "ownerKey"
WHERE "organizationId" IS NOT NULL;

ALTER TABLE "SkillVersion" ADD COLUMN "organizationId" TEXT;
UPDATE "SkillVersion" r SET "organizationId" = m."orgId"
FROM (
    SELECT DISTINCT ON (m."userId") m."userId", m."orgId"
    FROM "OrgMember" m JOIN "Organization" o ON o."id" = m."orgId"
    WHERE m."isOwner" AND o."isPersonal" AND o."deletedAt" IS NULL
    ORDER BY m."userId", m."createdAt", m."id"
) m
WHERE r."userId" = m."userId";
UPDATE "SkillVersion" SET "ownerKey" = 'org:' || "organizationId" || ':' || "ownerKey"
WHERE "organizationId" IS NOT NULL;

ALTER TABLE "SkillSuppression" ADD COLUMN "organizationId" TEXT;
UPDATE "SkillSuppression" r SET "organizationId" = m."orgId"
FROM (
    SELECT DISTINCT ON (m."userId") m."userId", m."orgId"
    FROM "OrgMember" m JOIN "Organization" o ON o."id" = m."orgId"
    WHERE m."isOwner" AND o."isPersonal" AND o."deletedAt" IS NULL
    ORDER BY m."userId", m."createdAt", m."id"
) m
WHERE r."userId" = m."userId";
UPDATE "SkillSuppression" SET "ownerKey" = 'org:' || "organizationId" || ':' || "ownerKey"
WHERE "organizationId" IS NOT NULL;

ALTER TABLE "SkillUseEvent" ADD COLUMN "organizationId" TEXT;
UPDATE "SkillUseEvent" r SET "organizationId" = m."orgId"
FROM (
    SELECT DISTINCT ON (m."userId") m."userId", m."orgId"
    FROM "OrgMember" m JOIN "Organization" o ON o."id" = m."orgId"
    WHERE m."isOwner" AND o."isPersonal" AND o."deletedAt" IS NULL
    ORDER BY m."userId", m."createdAt", m."id"
) m
WHERE r."userId" = m."userId";
UPDATE "SkillUseEvent" SET "ownerKey" = 'org:' || "organizationId" || ':' || "ownerKey"
WHERE "organizationId" IS NOT NULL;

ALTER TABLE "ExpertPod" ADD COLUMN "organizationId" TEXT;
UPDATE "ExpertPod" r SET "organizationId" = m."orgId"
FROM (
    SELECT DISTINCT ON (m."userId") m."userId", m."orgId"
    FROM "OrgMember" m JOIN "Organization" o ON o."id" = m."orgId"
    WHERE m."isOwner" AND o."isPersonal" AND o."deletedAt" IS NULL
    ORDER BY m."userId", m."createdAt", m."id"
) m
WHERE r."userId" = m."userId";

DROP INDEX "ExpertPod_userId_name_key";
CREATE UNIQUE INDEX "ExpertPod_userId_organizationId_name_key" ON "ExpertPod" ("userId", "organizationId", "name");

COMMIT;
