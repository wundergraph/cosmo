DO $$ BEGIN
 CREATE TYPE "subscription_protocol" AS ENUM('ws', 'sse', 'sse_post');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "subgraphs" ADD COLUMN "subscription_protocol" "subscription_protocol" DEFAULT 'ws' NOT NULL;
