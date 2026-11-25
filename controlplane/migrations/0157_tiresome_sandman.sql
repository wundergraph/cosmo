-- Team collection names were not unique before this migration, so a graph can
-- already hold team collections that differ only in case. Keep the oldest of
-- each such group as it is and rename the others to "<name> (1)", "<name> (2)"
-- and so on, skipping any name another team collection on the graph already
-- uses. Private collections are not touched.
DO $$
DECLARE
  dup RECORD;
  candidate TEXT;
  n INT;
BEGIN
  FOR dup IN
    SELECT "id", "federated_graph_id", "name"
    FROM (
      SELECT "id", "federated_graph_id", "name",
        row_number() OVER (
          PARTITION BY "federated_graph_id", lower("name")
          ORDER BY "created_at", "id"
        ) AS "position"
      FROM "graph_collections"
      WHERE "private_to_user_id" IS NULL
    ) AS "ranked"
    WHERE "position" > 1
    ORDER BY "federated_graph_id", lower("name"), "position"
  LOOP
    n := 1;
    LOOP
      candidate := dup."name" || ' (' || n || ')';
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "graph_collections"
        WHERE "federated_graph_id" = dup."federated_graph_id"
          AND "private_to_user_id" IS NULL
          AND lower("name") = lower(candidate)
      );
      n := n + 1;
    END LOOP;
    UPDATE "graph_collections" SET "name" = candidate, "updated_at" = now() WHERE "id" = dup."id";
  END LOOP;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gc_unique_team_name" ON "graph_collections" USING btree ("federated_graph_id",lower("name")) WHERE "graph_collections"."private_to_user_id" IS NULL;
