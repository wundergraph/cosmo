ALTER TABLE "federated_graph_collection_operations" DROP CONSTRAINT "federated_graph_collection_operations_file_path_unique";--> statement-breakpoint
ALTER TABLE "federated_graph_collection_protocols" ADD COLUMN "file_path" text NOT NULL;--> statement-breakpoint
ALTER TABLE "federated_graph_collection_operations" DROP COLUMN IF EXISTS "file_path";--> statement-breakpoint
ALTER TABLE "federated_graph_collection_protocols" ADD CONSTRAINT "federated_graph_collection_protocols_file_path_unique" UNIQUE("file_path");