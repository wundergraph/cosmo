CREATE TABLE IF NOT EXISTS "target_label_matchers" (
	"target_id" uuid NOT NULL,
	"label_matcher" text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "targets" ALTER COLUMN "labels" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "target_label_matchers" ADD CONSTRAINT "target_label_matchers_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "targets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
