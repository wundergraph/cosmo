import { OrganizationRole } from '../../db/models.js';
import { OrganizationGroupDTO } from '../../types/index.js';

interface RuleData {
  namespaces: string[];
  resources: string[];
}

type OrganizationRoleWithoutOrg = Exclude<
  OrganizationRole,
  'organization-admin' | 'organization-developer' | 'organization-viewer'
>;

export class RBACEvaluator {
  readonly roles: OrganizationRole[];
  readonly namespaces: string[];
  readonly resources: string[];
  readonly rules: ReadonlyMap<OrganizationRole, RuleData>;

  readonly isOrganizationAdmin: boolean;
  readonly isOrganizationAdminOrDeveloper: boolean;
  readonly isOrganizationViewer: boolean;

  constructor(readonly groups: Omit<OrganizationGroupDTO, 'membersCount' | 'kcGroupId' | 'kcMapperId'>[]) {
    const flattenRules = groups.flatMap((group) => group.rules);
    const rulesGroupedByRole = Object.groupBy(flattenRules, (rule) => rule.role);

    const result = new Map<OrganizationRole, RuleData>();
    for (const [role, ruleData] of Object.entries(rulesGroupedByRole)) {
      result.set(role as OrganizationRole, {
        namespaces: [...new Set(ruleData.flatMap((r) => r.namespaces))],
        resources: [...new Set(ruleData.flatMap((r) => r.resources))],
      });
    }

    this.roles = Array.from(result.keys(), (k) => k);
    this.namespaces = [...new Set(Array.from(result.values(), (res) => res.namespaces).flat())];
    this.resources = [...new Set(Array.from(result.values(), (res) => res.resources).flat())];
    this.rules = result;

    this.isOrganizationAdmin = this.is('organization-admin');
    this.isOrganizationAdminOrDeveloper = this.isOrganizationAdmin || this.is('organization-developer');
    this.isOrganizationViewer = this.isOrganizationAdminOrDeveloper || this.is('organization-viewer');
  }

  is(...roles: OrganizationRole[]) {
    if (roles.length === 0) {
      return false;
    }

    for (const role of roles) {
      if (this.roles.includes(role)) {
        return true;
      }
    }

    return false;
  }

  checkNamespaceAccess(
    namespace: string,
    requiredRole: Exclude<OrganizationRoleWithoutOrg, 'graph-admin' | 'graph-viewer' | 'subgraph-publisher'>,
  ) {
    const rule = this.rules.get(requiredRole);
    if (!rule) {
      return false;
    }

    if (namespace === '*') {
      return rule.namespaces.length === 0;
    }

    return rule.namespaces.length === 0 || rule.namespaces.includes(namespace);
  }

  checkTargetAccess(
    target: string,
    requiredRole: Exclude<OrganizationRoleWithoutOrg, 'namespace-admin' | 'namespace-viewer'>,
  ) {
    const rule = this.rules.get(requiredRole);
    if (!rule) {
      return false;
    }

    if (target === '*') {
      return rule.resources.length === 0;
    }

    return rule.resources.length === 0 || rule.resources.includes(target);
  }
}
