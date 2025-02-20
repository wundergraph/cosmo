CREATE TABLE IF NOT EXISTS "namespace_cache_warmer_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"max_operations_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "namespace_cache_warmer_config_namespace_id_unique" UNIQUE("namespace_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespace_cache_warmer_config" ADD CONSTRAINT "namespace_cache_warmer_config_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nscwc_namespace_id_idx" ON "namespace_cache_warmer_config" USING btree ("namespace_id");