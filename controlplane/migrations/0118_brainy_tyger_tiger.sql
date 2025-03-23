ALTER TABLE "proposal_subgraphs" ALTER COLUMN "subgraph_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "did_hub_create" boolean DEFAULT false NOT NULL;