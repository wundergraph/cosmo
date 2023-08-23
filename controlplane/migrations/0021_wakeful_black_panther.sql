-- Custom SQL migration file, put you code below! --

-- Create an index on the labels column for faster lookups
-- Drizzle does not support GIN indexes yet, so we need to create it manually
CREATE INDEX IF NOT EXISTS "label_idx" ON "targets" USING GIN ("labels");