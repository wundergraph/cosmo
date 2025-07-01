CREATE TYPE "public"."collection_protocols" AS ENUM('grpc', 'mcp');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "federated_graph_collection_protocols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"protocol" "collection_protocols" NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "federated_graph_collection_protocols" ADD CONSTRAINT "federated_graph_collection_protocols_collection_id_federated_graph_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."federated_graph_collections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fgcp_collection_id_idx" ON "federated_graph_collection_protocols" USING btree ("collection_id");