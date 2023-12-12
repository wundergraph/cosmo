ALTER TABLE "api_key_resources" DROP CONSTRAINT "api_key_resources_target_id_targets_id_fk";
--> statement-breakpoint
ALTER TABLE "api_key_resources" ALTER COLUMN "target_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_key_resources" ADD CONSTRAINT "api_key_resources_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "targets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
