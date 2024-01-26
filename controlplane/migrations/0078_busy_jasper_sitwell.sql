DROP INDEX IF EXISTS "organization_name_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_name_idx" ON "targets" ("organization_id","type","name","namespace_id");