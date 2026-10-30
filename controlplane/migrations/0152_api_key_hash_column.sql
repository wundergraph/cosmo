ALTER TABLE "api_keys" ALTER COLUMN "key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "key_hash" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash");--> statement-breakpoint
CREATE FUNCTION "api_keys_hash_key"() RETURNS trigger AS $$
BEGIN
  IF NEW."key" IS NOT NULL THEN
    NEW."key_hash" := encode(sha256(convert_to(NEW."key", 'UTF8')), 'hex');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "api_keys_hash_key" BEFORE INSERT OR UPDATE OF "key" ON "api_keys" FOR EACH ROW EXECUTE FUNCTION "api_keys_hash_key"();--> statement-breakpoint
UPDATE "api_keys" SET "key_hash" = encode(sha256(convert_to("key", 'UTF8')), 'hex');
