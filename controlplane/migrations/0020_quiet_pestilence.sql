DROP TABLE "target_labels";--> statement-breakpoint
ALTER TABLE "targets" ADD COLUMN "labels" text[] NOT NULL;--> statement-breakpoint
