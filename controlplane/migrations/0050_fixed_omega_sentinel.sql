CREATE TABLE IF NOT EXISTS "schema_check_federated_graphs" (
	"check_id" uuid NOT NULL,
	"federated_graph_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "traffic_check_days" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_federated_graphs" ADD CONSTRAINT "schema_check_federated_graphs_check_id_schema_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_federated_graphs" ADD CONSTRAINT "schema_check_federated_graphs_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
