-- Custom SQL migration file, put you code below! --

-- Convert String values to JSON --

UPDATE graph_compositions
SET router_config = (router_config#>> '{}')::jsonb;
UPDATE schema_checks
SET gh_details = (gh_details#>> '{}')::json;