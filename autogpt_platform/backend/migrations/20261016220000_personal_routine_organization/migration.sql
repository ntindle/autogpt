ALTER TABLE "ExpertRoutine" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ExpertRoutine" ADD CONSTRAINT "ExpertRoutine_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ExpertRoutine_userId_organizationId_idx" ON "ExpertRoutine"("userId", "organizationId");

UPDATE "ExpertRoutine" r SET "organizationId" = p."organizationId"
FROM "PersonalMemoryOrganization" p
WHERE r."userId" = p."userId" AND r."expertId" IS NULL;

-- Old writers may omit scope during a rolling deploy. Only the durable original
-- personal organization can supply it; navigation state is never consulted.
CREATE FUNCTION personal_routine_organization() RETURNS trigger AS $$
BEGIN
  IF NEW."expertId" IS NULL AND NEW."organizationId" IS NULL THEN
    SELECT "organizationId" INTO NEW."organizationId"
    FROM "PersonalMemoryOrganization" WHERE "userId" = NEW."userId";
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."organizationId" IS NOT NULL
     AND (NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
          OR NEW."userId" IS DISTINCT FROM OLD."userId"
          OR NEW."expertId" IS DISTINCT FROM OLD."expertId") THEN
    RAISE EXCEPTION 'Routine ownership is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER personal_routine_organization BEFORE INSERT OR UPDATE ON "ExpertRoutine"
FOR EACH ROW EXECUTE FUNCTION personal_routine_organization();
