import { OrganizationRole } from '../../db/models.js';
import { OrganizationGroupDTO } from '../../types/index.js';

export class RBACEvaluator {
  readonly roles: OrganizationRole[];
  readonly rules: ReadonlyMap<OrganizationRole, string[]>;

  constructor(readonly groups: Omit<OrganizationGroupDTO, 'membersCount' | 'kcMapperId'>[]) {
    const flattenRules = groups.flatMap((group) => group.rules);
    const rulesGroupedByRole = Object.groupBy(flattenRules, (rule) => rule.role);

    const result = new Map<OrganizationRole, string[]>();
    for (const [role, allResources] of Object.entries(rulesGroupedByRole)) {
      result.set(role as OrganizationRole, [...new Set(allResources.flatMap((res) => res.resources))]);
    }

    this.roles = Array.from(result.keys(), (k) => k);
    this.rules = result;
  }

  get isOrganizationAdmin() {
    return this.is(['organization-owner', 'organization-admin']);
  }

  get isOrganizationAdminOrDeveloper() {
    return this.is(['organization-owner', 'organization-admin', 'organization-developer']);
  }

  is(roles: OrganizationRole[]) {
    for (const role of roles) {
      if (this.roles.includes(role)) {
        return true;
      }
    }

    return false;
  }

  checkReadAccess(graph: { namespace: string; targetId: string }) {
    if (this.is(['organization-owner', 'organization-admin', 'organization-developer', 'organization-viewer'])) {
      return true;
    }

    for (const role of this.rules.keys()) {
      if (role.startsWith('organization-')) {
        continue;
      }

      const ruleForRole = this.rules.get(role)!;
      if (
        ruleForRole.length === 0 ||
        ruleForRole.includes(`ns:${graph.namespace}`) ||
        ruleForRole.includes(graph.targetId)
      ) {
        return true;
      }
    }

    return false;
  }

  checkWriteGraphAccess(graph: { namespace: string; targetId: string }) {
    if (this.is(['organization-owner', 'organization-admin', 'organization-developer'])) {
      return true;
    }

    for (const role of this.rules.keys()) {
      if (role.startsWith('organization-') || role.endsWith('-viewer')) {
        continue;
      }

      const ruleForRole = this.rules.get(role)!;
      if (
        ruleForRole.length === 0 ||
        ruleForRole.includes(`ns:${graph.namespace}`) ||
        ruleForRole.includes(graph.targetId)
      ) {
        return true;
      }
    }

    return false;
  }
}
