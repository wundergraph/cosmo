ALTER TYPE "public"."hub_permission" ADD VALUE 'view_hidden_schema';--> statement-breakpoint
ALTER TABLE "organization_group_hub_permissions" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;