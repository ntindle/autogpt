ALTER TABLE "SkillListing" ADD COLUMN "organizationId" TEXT;
UPDATE "SkillListing" s SET "organizationId" = m."orgId"
FROM (
    SELECT DISTINCT ON (m."userId") m."userId", m."orgId"
    FROM "OrgMember" m JOIN "Organization" o ON o."id" = m."orgId"
    WHERE m."isOwner" AND o."isPersonal" AND o."deletedAt" IS NULL
    ORDER BY m."userId", m."createdAt", m."id"
) m
WHERE s."owningUserId" = m."userId";
