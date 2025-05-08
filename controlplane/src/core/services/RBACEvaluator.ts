import { inArray, or, SQL } from 'drizzle-orm';
import { OrganizationRole } from '../../db/models.js';
import { OrganizationGroupDTO } from '../../types/index.js';
import * as schema from '../../db/schema.js';

interface RuleData {
  namespaces: string[];
  resources: string[];
}

export class RBACEvaluator {
  readonly roles: OrganizationRole[];
  readonly namespaces: string[];
  readonly resources: string[];
  readonly rules: ReadonlyMap<OrganizationRole, RuleData>;

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
  }

  get isOrganizationAdmin() {
    return this.is(['organization-admin']);
  }

  get isOrganizationDeveloper() {
    return this.isOrganizationAdmin || this.is(['organization-developer']);
  }

  get isOrganizationViewer() {
    return this.isOrganizationDeveloper || this.is(['organization-viewer']);
  }

  is(roles: OrganizationRole[]) {
    for (const role of roles) {
      if (this.roles.includes(role)) {
        return true;
      }
    }

    return false;
  }

  checkReadAccess(graph: { targetId: string }) {
    if (this.isOrganizationViewer) {
      return true;
    }

    for (const role of this.rules.keys()) {
      const ruleForRole = this.rules.get(role)!;
      if (ruleForRole.resources.includes(graph.targetId)) {
        return true;
      }
    }

    return false;
  }

  checkNamespaceWriteAccess(namespaceId: string) {
    if (this.isOrganizationDeveloper) {
      return true;
    }

    for (const role of this.rules.keys()) {
      if (role.endsWith('-viewer')) {
        continue;
      }

      const ruleForRole = this.rules.get(role)!;
      if (ruleForRole.namespaces.includes(namespaceId)) {
        return true;
      }
    }

    return false;
  }

  checkResourceWriteAccess(targetId: string) {
    if (this.isOrganizationDeveloper) {
      return true;
    }

    for (const role of this.rules.keys()) {
      if (role.endsWith('-viewer')) {
        continue;
      }

      const ruleForRole = this.rules.get(role)!;
      if (ruleForRole.resources.includes(targetId)) {
        return true;
      }
    }

    return false;
  }

  applyQueryConditions(conditions: (SQL<unknown> | undefined)[]) {
    if (this.isOrganizationViewer) {
      return;
    }

    if (this.namespaces.length > 0) {
      conditions.push(
        this.resources.length > 0
          ? or(inArray(schema.targets.namespaceId, this.namespaces), inArray(schema.targets.id, this.resources))
          : inArray(schema.targets.namespaceId, this.namespaces),
      );
    } else if (this.resources.length > 0) {
      conditions.push(inArray(schema.targets.id, this.resources));
    }
  }
}
