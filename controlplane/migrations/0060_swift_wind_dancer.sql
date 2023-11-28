ALTER TABLE "federated_graph_persisted_operations" DROP CONSTRAINT "federated_graph_operation_hash";--> statement-breakpoint
ALTER TABLE "federated_graph_persisted_operations" DROP CONSTRAINT "federated_graph_operation_file_hash";--> statement-breakpoint
-- In order to migrate the existing data, create the column first allowing NULL values,
-- update it and finally disable NULL entries.
ALTER TABLE "federated_graph_persisted_operations" ADD COLUMN "operation_id" text;--> statement-breakpoint
UPDATE "federated_graph_persisted_operations" SET "operation_id" = "hash";
ALTER TABLE "federated_graph_persisted_operations" ALTER COLUMN "operation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "federated_graph_persisted_operations" ADD CONSTRAINT "federated_graph_persisted_operations_file_path_unique" UNIQUE("file_path");--> statement-breakpoint
ALTER TABLE "federated_graph_persisted_operations" ADD CONSTRAINT "federated_graph_operation_id" UNIQUE("federated_graph_id","client_id","operation_id");
