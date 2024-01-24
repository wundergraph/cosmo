CREATE TABLE IF NOT EXISTS "namespaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid,
	CONSTRAINT "unique_name" UNIQUE("name","organization_id")
);
--> statement-breakpoint
DROP INDEX IF EXISTS "organization_name_idx";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "target_namespace_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "target_namespace" text;--> statement-breakpoint
ALTER TABLE "targets" ADD COLUMN "namespace_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_name_idx" ON "targets" ("organization_id","name","namespace_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "targets" ADD CONSTRAINT "targets_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespaces" ADD CONSTRAINT "namespaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespaces" ADD CONSTRAINT "namespaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

BEGIN TRANSACTION;

-- Create default namespace for all organizations --

INSERT INTO namespaces (name, organization_id, created_by)
SELECT 'default' AS name, o.id AS organization_id, o.user_id AS created_by
FROM organizations o;

-- Update existing targets with the default namespace --

UPDATE targets t
SET namespace_id = n.id
FROM namespaces n
WHERE t.organization_id = n.organization_id AND n.name = 'default';

-- Set namespace to not be null in targets table --

ALTER TABLE targets
ALTER COLUMN namespace_id SET NOT NULL;

COMMIT;
