ALTER TABLE "graph_api_tokens" DROP CONSTRAINT "graph_api_tokens_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "graph_api_tokens" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_api_tokens" ADD CONSTRAINT "graph_api_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "graph_api_tokens" DROP COLUMN IF EXISTS "user_id";