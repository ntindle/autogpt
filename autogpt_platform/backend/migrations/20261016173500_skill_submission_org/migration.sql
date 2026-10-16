ALTER TABLE "SkillListing" ADD COLUMN "organizationId" TEXT;
UPDATE "SkillListing" s SET "organizationId" = m."orgId"
FROM "OrgMember" m JOIN "Organization" o ON o."id" = m."orgId" AND o."isPersonal"
WHERE s."owningUserId" = m."userId";
