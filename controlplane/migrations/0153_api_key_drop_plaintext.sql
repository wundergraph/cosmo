CREATE OR REPLACE FUNCTION "api_keys_hash_key"() RETURNS trigger AS $$
BEGIN
  IF NEW."key" IS NOT NULL THEN
    NEW."key_hash" := encode(sha256(convert_to(NEW."key", 'UTF8')), 'hex');
    NEW."key" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
UPDATE "api_keys" SET "key" = NULL WHERE "key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "key_hash" SET NOT NULL;
