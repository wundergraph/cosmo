ALTER TABLE "public"."proposals" ALTER COLUMN "state" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."proposal_state";--> statement-breakpoint
CREATE TYPE "public"."proposal_state" AS ENUM('DRAFT', 'APPROVED', 'PUBLISHED', 'CLOSED');--> statement-breakpoint
ALTER TABLE "public"."proposals" ALTER COLUMN "state" SET DATA TYPE "public"."proposal_state" USING "state"::"public"."proposal_state";