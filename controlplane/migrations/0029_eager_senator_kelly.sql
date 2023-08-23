DROP INDEX IF EXISTS "name_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_name_idx" ON "targets" ("organization_id","name");