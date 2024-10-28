CREATE INDEX IF NOT EXISTS "graphcomp_is_composable_idx" ON "graph_compositions" USING btree ("is_composable");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graphcomp_deployment_error_idx" ON "graph_compositions" USING btree ("deployment_error");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graphcomp_admission_error_idx" ON "graph_compositions" USING btree ("admission_error");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graphcomp_is_feature_flag_composition_idx" ON "graph_compositions" USING btree ("is_feature_flag_composition");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sv_target_id_idx" ON "schema_versions" USING btree ("target_id");