BEGIN TRANSACTION;
UPDATE "graph_api_tokens"
SET "name" = 
    CASE 
        WHEN "name" IS NOT NULL AND "name" <> '' 
        THEN CONCAT("name", '_', LEFT(gen_random_uuid()::text, 6))
        ELSE LEFT(gen_random_uuid()::text, 6)
    END;

COMMIT;

CREATE UNIQUE INDEX IF NOT EXISTS "graphApiToken_name_idx" ON "graph_api_tokens" ("name","federated_graph_id");