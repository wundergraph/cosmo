ALTER TABLE "federated_graph_collection_operations" RENAME COLUMN "operation_name" TO "name";--> statement-breakpoint
ALTER TABLE "federated_graph_collection_operations" RENAME COLUMN "operation_content" TO "content";--> statement-breakpoint
ALTER TABLE "federated_graph_collection_operations" DROP CONSTRAINT "federated_graph_collection_operation_name";--> statement-breakpoint
ALTER TABLE "federated_graph_collection_operations" ADD CONSTRAINT "federated_graph_collection_operation_name" UNIQUE("collection_id","name");