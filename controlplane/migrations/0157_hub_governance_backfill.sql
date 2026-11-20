-- Seed the default Hub permissions of the groups every organization starts with.
INSERT INTO "organization_group_hub_permissions" ("group_id", "permission")
SELECT "organization_groups"."id", "permissions"."permission"::"hub_permission"
FROM "organization_groups"
CROSS JOIN (
  VALUES
    ('create_sandbox'),
    ('share_sandbox'),
    ('edit_sandbox'),
    ('propose'),
    ('approve'),
    ('run_agents'),
    ('open_portals'),
    ('approve_egress'),
    ('manage_egress_credentials'),
    ('manage_integrations'),
    ('view_audit_log')
) AS "permissions"("permission")
WHERE "organization_groups"."name" = 'admin' AND "organization_groups"."builtin" = true
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "organization_group_hub_permissions" ("group_id", "permission")
SELECT "organization_groups"."id", "permissions"."permission"::"hub_permission"
FROM "organization_groups"
CROSS JOIN (
  VALUES
    ('create_sandbox'),
    ('share_sandbox'),
    ('edit_sandbox'),
    ('propose'),
    ('approve'),
    ('run_agents'),
    ('open_portals')
) AS "permissions"("permission")
WHERE "organization_groups"."name" = 'developer'
ON CONFLICT DO NOTHING;
