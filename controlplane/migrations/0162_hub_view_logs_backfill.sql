-- Grant view_logs to the default developer and viewer groups of existing organizations.
INSERT INTO "organization_group_hub_permissions" ("group_id", "permission")
SELECT "organization_groups"."id", 'view_logs'::"hub_permission"
FROM "organization_groups"
WHERE "organization_groups"."name" IN ('developer', 'viewer')
ON CONFLICT DO NOTHING;
