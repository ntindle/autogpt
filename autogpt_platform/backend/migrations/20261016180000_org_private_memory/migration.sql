CREATE TABLE "PersonalMemoryOrganization" (
    "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "PersonalMemoryOrganization" ("userId", "organizationId")
SELECT DISTINCT ON (m."userId") m."userId", m."orgId"
FROM "OrgMember" m JOIN "Organization" o ON o."id" = m."orgId"
WHERE m."isOwner" AND o."isPersonal" AND o."deletedAt" IS NULL
ORDER BY m."userId", m."createdAt", m."id";

CREATE TABLE "MemoryScopeRegistry" (
    "scopeKey" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "organizationId" TEXT REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "expertId" TEXT,
    "groupId" TEXT NOT NULL
);
CREATE INDEX "MemoryScopeRegistry_userId_idx" ON "MemoryScopeRegistry"("userId");

INSERT INTO "MemoryScopeRegistry" ("scopeKey", "userId", "groupId")
SELECT "userId", "userId", 'user_' || "userId" FROM "PersonalMemoryOrganization";

INSERT INTO "MemoryScopeRegistry" ("scopeKey", "userId", "expertId", "groupId")
SELECT 'expert_' || encode(sha256(convert_to(e."id", 'UTF8')), 'hex'),
       e."ownerUserId", e."id", 'expert_' || encode(sha256(convert_to(e."id", 'UTF8')), 'hex')
FROM "Expert" e JOIN "PersonalMemoryOrganization" p ON p."userId" = e."ownerUserId"
WHERE NOT e."isTemplate";
