CREATE TYPE "public"."proposal_origin" AS ENUM('COSMO', 'HUB');--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "origin" "proposal_origin" DEFAULT 'COSMO' NOT NULL;