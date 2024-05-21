DO $$ BEGIN
 CREATE TYPE "websocket_subprotocol" AS ENUM('auto', 'graphql-ws', 'graphql-transport-ws');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "subgraphs" ADD COLUMN "websocket_subprotocol" "websocket_subprotocol" DEFAULT 'auto' NOT NULL;