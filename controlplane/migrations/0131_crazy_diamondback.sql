CREATE TABLE IF NOT EXISTS "linked_schema_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_id" uuid,
	"linked_schema_check_id" uuid,
	CONSTRAINT "linked_schema_checks_schema_check_id_unique" UNIQUE("schema_check_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linked_schema_checks" ADD CONSTRAINT "linked_schema_checks_schema_check_id_schema_checks_id_fk" FOREIGN KEY ("schema_check_id") REFERENCES "public"."schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linked_schema_checks" ADD CONSTRAINT "linked_schema_checks_linked_schema_check_id_schema_checks_id_fk" FOREIGN KEY ("linked_schema_check_id") REFERENCES "public"."schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lsc_schema_check_id_idx" ON "linked_schema_checks" USING btree ("schema_check_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lsc_linked_schema_check_id_idx" ON "linked_schema_checks" USING btree ("linked_schema_check_id");