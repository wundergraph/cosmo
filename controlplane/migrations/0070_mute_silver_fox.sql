DROP TABLE "organization_limits" IF;--> statement-breakpoint
ALTER TABLE "organization_features" ALTER COLUMN "limit" SET DATA TYPE numeric(4, 2);--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "is_personal";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "is_free_trial";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "is_rbac_enabled";