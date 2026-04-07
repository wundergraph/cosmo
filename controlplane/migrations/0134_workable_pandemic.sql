ALTER TYPE "public"."webhook_delivery_type" ADD VALUE 'check-extension';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "namespace_subgraph_check_extensions_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"secret_key" text,
	"include_composed_sdl" boolean DEFAULT false NOT NULL,
	"include_linting_issues" boolean DEFAULT false NOT NULL,
	"include_pruning_issues" boolean DEFAULT false NOT NULL,
	"include_schema_changes" boolean DEFAULT false NOT NULL,
	"include_affected_operations" boolean DEFAULT false NOT NULL,
	CONSTRAINT "namespace_subgraph_check_extensions_config_namespace_id_unique" UNIQUE("namespace_id")
);
--> statement-breakpoint
ALTER TABLE "namespace_lint_check_config" ALTER COLUMN "lint_rule" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "schema_check_lint_action" ALTER COLUMN "lint_rule_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "namespace_config" ADD COLUMN "enable_subgraph_check_extensions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "check_extension_delivery_id" uuid;--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "check_extension_error_message" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespace_subgraph_check_extensions_config" ADD CONSTRAINT "namespace_subgraph_check_extensions_config_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nsce_namespace_id_idx" ON "namespace_subgraph_check_extensions_config" USING btree ("namespace_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_checks" ADD CONSTRAINT "schema_checks_check_extension_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("check_extension_delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP TYPE "public"."lint_rules";