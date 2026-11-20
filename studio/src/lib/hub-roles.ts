import { create } from '@bufbuild/protobuf';
import {
  type HubPermissionGrant,
  HubPermissionGrantSchema,
  type UpdateOrganizationGroupRequest_GroupRule,
  UpdateOrganizationGroupRequest_GroupRuleSchema,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

// Each Hub permission belongs to exactly one Hub role, so roles and stored grants convert both ways.
const hubRolePermissions: Record<string, readonly string[]> = {
  'hub-sandbox-editor': ['create_sandbox', 'share_sandbox', 'edit_sandbox'],
  'hub-proposer': ['propose'],
  'hub-approver': ['approve'],
  'hub-agent-runner': ['run_agents'],
  'hub-portal-viewer': ['open_portals'],
  'hub-egress-manager': ['approve_egress', 'manage_egress_credentials'],
  'hub-integration-manager': ['manage_integrations'],
  'hub-audit-viewer': ['view_audit_log'],
};

export function isHubRole(role: string): boolean {
  return role in hubRolePermissions;
}

export function hubRulesFromGrants(grants: readonly HubPermissionGrant[]): UpdateOrganizationGroupRequest_GroupRule[] {
  const grantedPermissions = new Set(grants.map((grant) => grant.permission));

  return Object.entries(hubRolePermissions)
    .filter(([, permissions]) => permissions.some((permission) => grantedPermissions.has(permission)))
    .map(([role]) => create(UpdateOrganizationGroupRequest_GroupRuleSchema, { role }));
}

export function grantsFromHubRules(rules: readonly UpdateOrganizationGroupRequest_GroupRule[]): HubPermissionGrant[] {
  return rules.flatMap((rule) => {
    const permissions = hubRolePermissions[rule.role] ?? [];

    return permissions.map((permission) => create(HubPermissionGrantSchema, { permission }));
  });
}
