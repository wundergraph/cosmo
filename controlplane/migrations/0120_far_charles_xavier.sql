ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "organization_slug" text;

-- Update the `organization_slug` to the corresponding one
BEGIN TRANSACTION;

UPDATE "public"."audit_logs" "al"
SET "organization_slug" = "org"."slug"
    FROM "public"."organizations" "org"
WHERE
    "al"."organization_slug" IS NULL AND
    "org"."id" = "al"."organization_id";

COMMIT;