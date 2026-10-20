CREATE TABLE IF NOT EXISTS "playground_default_headers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"federated_graph_id" uuid NOT NULL,
	"user_id" uuid,
	"headers" json DEFAULT '[]'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playground_default_headers" ADD CONSTRAINT "playground_default_headers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playground_default_headers" ADD CONSTRAINT "playground_default_headers_federated_graph_id_federated_graphs_id_fk" FOREIGN KEY ("federated_graph_id") REFERENCES "public"."federated_graphs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playground_default_headers" ADD CONSTRAINT "playground_default_headers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pdh_federated_graph_id_idx" ON "playground_default_headers" USING btree ("federated_graph_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pdh_unique_graph_level" ON "playground_default_headers" USING btree ("federated_graph_id") WHERE "playground_default_headers"."user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pdh_unique_personal_level" ON "playground_default_headers" USING btree ("federated_graph_id","user_id") WHERE "playground_default_headers"."user_id" IS NOT NULL;