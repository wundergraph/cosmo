ALTER TABLE "proposal_subgraphs" ALTER COLUMN "subgraph_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_subgraphs" ADD COLUMN "subgraph_name" text;