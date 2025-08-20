CREATE TABLE IF NOT EXISTS "linked_subgraphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_subgraph_id" uuid NOT NULL,
	"target_subgraph_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	CONSTRAINT "linked_subgraphs_source_subgraph_id_unique" UNIQUE("source_subgraph_id"),
	CONSTRAINT "unique_source_subgraph" UNIQUE("source_subgraph_id")
);
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
CREATE INDEX IF NOT EXISTS "ls_source_subgraph_id_idx" ON "linked_subgraphs" USING btree ("source_subgraph_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ls_target_subgraph_id_idx" ON "linked_subgraphs" USING btree ("target_subgraph_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ls_created_by_id_idx" ON "linked_subgraphs" USING btree ("created_by_id");