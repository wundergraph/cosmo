ALTER TABLE "organizations" ADD COLUMN "kc_group_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_kc_group_id_unique" UNIQUE("kc_group_id");