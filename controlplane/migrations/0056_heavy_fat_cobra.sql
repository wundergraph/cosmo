ALTER TABLE "federated_graph_clients" ADD COLUMN "created_by" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "federated_graph_clients" ADD COLUMN "updated_by" uuid NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_clients" ADD CONSTRAINT "federated_graph_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_clients" ADD CONSTRAINT "federated_graph_clients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
