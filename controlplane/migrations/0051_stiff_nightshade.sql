ALTER TABLE "schema_check_federated_graphs" ADD COLUMN "traffic_check_days" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_checks" DROP COLUMN IF EXISTS "traffic_check_days";