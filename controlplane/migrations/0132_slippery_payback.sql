CREATE TYPE "public"."proposal_origin" AS ENUM('INTERNAL', 'EXTERNAL');--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "origin" "proposal_origin" DEFAULT 'INTERNAL' NOT NULL;