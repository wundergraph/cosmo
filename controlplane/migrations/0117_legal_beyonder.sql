CREATE TABLE IF NOT EXISTS "namespace_proposal_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"check_severity_level" "lint_severity" NOT NULL,
	"publish_severity_level" "lint_severity" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_subgraphs" DROP CONSTRAINT "proposal_subgraphs_subgraph_id_subgraphs_id_fk";
--> statement-breakpoint
ALTER TABLE "namespace_config" ADD COLUMN "enable_proposals" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_subgraphs" ADD COLUMN "is_new" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_subgraphs" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespace_proposal_config" ADD CONSTRAINT "namespace_proposal_config_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "npc_namespace_id_idx" ON "namespace_proposal_config" USING btree ("namespace_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_subgraphs" ADD CONSTRAINT "proposal_subgraphs_subgraph_id_subgraphs_id_fk" FOREIGN KEY ("subgraph_id") REFERENCES "public"."subgraphs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
