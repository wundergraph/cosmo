import { create } from '@bufbuild/protobuf';
import {
  HubPermissionGrantSchema,
  UpdateOrganizationGroupRequest_GroupRuleSchema,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { expect, test } from 'vitest';
import { grantsFromHubRules, hubRulesFromGrants, isHubRole } from '../lib/hub-roles';

test('that a Hub role is saved as every permission it covers', () => {
  const rules = [
    create(UpdateOrganizationGroupRequest_GroupRuleSchema, { role: 'hub-sandbox-editor' }),
    create(UpdateOrganizationGroupRequest_GroupRuleSchema, { role: 'hub-egress-manager' }),
  ];

  expect(grantsFromHubRules(rules).map((grant) => grant.permission)).toEqual([
    'create_sandbox',
    'share_sandbox',
    'edit_sandbox',
    'approve_egress',
    'manage_egress_credentials',
  ]);
});

test('that stored permissions load as the Hub roles that cover them', () => {
  const grants = ['create_sandbox', 'propose', 'view_audit_log'].map((permission) =>
    create(HubPermissionGrantSchema, { permission }),
  );

  expect(hubRulesFromGrants(grants).map((rule) => rule.role)).toEqual([
    'hub-sandbox-editor',
    'hub-proposer',
    'hub-audit-viewer',
  ]);
});

test('that only Hub roles are told apart from Studio roles', () => {
  expect(isHubRole('hub-approver')).toBe(true);
  expect(isHubRole('graph-admin')).toBe(false);
});
