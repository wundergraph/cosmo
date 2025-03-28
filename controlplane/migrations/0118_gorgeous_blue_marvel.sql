DROP INDEX IF EXISTS "npc_namespace_id_idx";--> statement-breakpoint
ALTER TABLE "namespace_proposal_config" ADD CONSTRAINT "npc_namespace_id_idx" UNIQUE("namespace_id");