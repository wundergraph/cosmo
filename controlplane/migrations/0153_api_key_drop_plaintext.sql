DROP TRIGGER "api_keys_hash_key" ON "api_keys";--> statement-breakpoint
DROP FUNCTION "api_keys_hash_key"();--> statement-breakpoint
UPDATE "api_keys" SET "key" = NULL WHERE "key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "key_hash" SET NOT NULL;
