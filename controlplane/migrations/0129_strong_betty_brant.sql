CREATE TABLE IF NOT EXISTS "linked_schema_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_id" uuid NOT NULL,
	"linked_schema_check_id" uuid NOT NULL,
	CONSTRAINT "linked_schema_checks_schema_check_id_unique" UNIQUE("schema_check_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "linked_subgraphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_subgraph_id" uuid NOT NULL,
	"target_subgraph_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	CONSTRAINT "linked_subgraphs_source_subgraph_id_unique" UNIQUE("source_subgraph_id")
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
DO $$ BEGIN
 ALTER TABLE "linked_subgraphs" ADD CONSTRAINT "linked_subgraphs_source_subgraph_id_subgraphs_id_fk" FOREIGN KEY ("source_subgraph_id") REFERENCES "public"."subgraphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linked_subgraphs" ADD CONSTRAINT "linked_subgraphs_target_subgraph_id_subgraphs_id_fk" FOREIGN KEY ("target_subgraph_id") REFERENCES "public"."subgraphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linked_subgraphs" ADD CONSTRAINT "linked_subgraphs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lsc_schema_check_id_idx" ON "linked_schema_checks" USING btree ("schema_check_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lsc_linked_schema_check_id_idx" ON "linked_schema_checks" USING btree ("linked_schema_check_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ls_source_subgraph_id_idx" ON "linked_subgraphs" USING btree ("source_subgraph_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ls_target_subgraph_id_idx" ON "linked_subgraphs" USING btree ("target_subgraph_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ls_created_by_id_idx" ON "linked_subgraphs" USING btree ("created_by_id");