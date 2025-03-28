CREATE TABLE IF NOT EXISTS "schema_check_subgraphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_id" uuid NOT NULL,
	"subgraph_id" uuid,
	"subgraph_name" text NOT NULL,
	"proposed_subgraph_schema_sdl" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schema_check_subgraphs_federated_graphs" (
	"schema_check_federated_graph_id" uuid,
	"schema_check_subgraph_id" uuid
);
--> statement-breakpoint
ALTER TABLE "schema_checks" ALTER COLUMN "target_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_check_change_action" ADD COLUMN "schema_check_subgraph_id" uuid;--> statement-breakpoint
ALTER TABLE "schema_check_federated_graphs" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_check_graph_pruning_action" ADD COLUMN "schema_check_subgraph_id" uuid;--> statement-breakpoint
ALTER TABLE "schema_check_lint_action" ADD COLUMN "schema_check_subgraph_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_subgraphs" ADD CONSTRAINT "schema_check_subgraphs_schema_check_id_schema_checks_id_fk" FOREIGN KEY ("schema_check_id") REFERENCES "public"."schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_subgraphs" ADD CONSTRAINT "schema_check_subgraphs_subgraph_id_subgraphs_id_fk" FOREIGN KEY ("subgraph_id") REFERENCES "public"."subgraphs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_subgraphs_federated_graphs" ADD CONSTRAINT "schema_check_subgraphs_federated_graphs_schema_check_federated_graph_id_schema_check_federated_graphs_id_fk" FOREIGN KEY ("schema_check_federated_graph_id") REFERENCES "public"."schema_check_federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_subgraphs_federated_graphs" ADD CONSTRAINT "schema_check_subgraphs_federated_graphs_schema_check_subgraph_id_schema_check_subgraphs_id_fk" FOREIGN KEY ("schema_check_subgraph_id") REFERENCES "public"."schema_check_subgraphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scs_schema_check_id_idx" ON "schema_check_subgraphs" USING btree ("schema_check_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scs_subgraph_id_idx" ON "schema_check_subgraphs" USING btree ("subgraph_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scsfg_schema_check_subgraph_id_idx" ON "schema_check_subgraphs_federated_graphs" USING btree ("schema_check_subgraph_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scsfg_schema_check_federated_graph_id_idx" ON "schema_check_subgraphs_federated_graphs" USING btree ("schema_check_federated_graph_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_change_action" ADD CONSTRAINT "schema_check_change_action_schema_check_subgraph_id_schema_check_subgraphs_id_fk" FOREIGN KEY ("schema_check_subgraph_id") REFERENCES "public"."schema_check_subgraphs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_graph_pruning_action" ADD CONSTRAINT "schema_check_graph_pruning_action_schema_check_subgraph_id_schema_check_subgraphs_id_fk" FOREIGN KEY ("schema_check_subgraph_id") REFERENCES "public"."schema_check_subgraphs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_lint_action" ADD CONSTRAINT "schema_check_lint_action_schema_check_subgraph_id_schema_check_subgraphs_id_fk" FOREIGN KEY ("schema_check_subgraph_id") REFERENCES "public"."schema_check_subgraphs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
