ALTER TABLE "plugin_image_versions" ADD COLUMN "platform" text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin_image_versions" DROP COLUMN IF EXISTS "architecture";--> statement-breakpoint
ALTER TABLE "plugin_image_versions" DROP COLUMN IF EXISTS "os";