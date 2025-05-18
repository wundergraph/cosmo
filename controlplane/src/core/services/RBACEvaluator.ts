import { OrganizationRole } from '../../db/models.js';
import { Feature, OrganizationGroupDTO } from '../../types/index.js';

interface RuleData {
  namespaces: string[];
  resources: string[];
}

interface Target {
  id: string;
  namespaceId: string;
  creatorUserId?: string;
}

export class RBACEvaluator {
  private readonly roles: OrganizationRole[];
  private readonly rules: ReadonlyMap<OrganizationRole, RuleData>;

  readonly namespaces: string[];
  readonly resources: string[];

  readonly isOrganizationAdmin: boolean;
  readonly isOrganizationAdminOrDeveloper: boolean;
  readonly isOrganizationViewer: boolean;

  readonly canManageAPIKeys: boolean;
  readonly canCreateNamespace: boolean;

  constructor(
    readonly groups: Omit<OrganizationGroupDTO, 'membersCount' | 'kcGroupId' | 'kcMapperId'>[],
    private readonly userId?: string,
    private readonly isRBACFeatureEnabled?: boolean,
  ) {
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

    this.isOrganizationAdmin = this.roles.includes('organization-admin');
    this.isOrganizationAdminOrDeveloper = this.isOrganizationAdmin || this.roles.includes('organization-developer');
    this.isOrganizationViewer = this.isOrganizationAdminOrDeveloper || this.roles.includes('organization-viewer');

    this.canManageAPIKeys =
      this.isOrganizationAdmin || (this.isRBACFeatureEnabled ? !!this.ruleFor('organization-apikey-manager') : true);

    this.canCreateNamespace =
      this.isOrganizationAdminOrDeveloper || this.ruleFor('namespace-admin')?.namespaces.length === 0;
  }

  ruleFor(role: OrganizationRole): RuleData | undefined {
    return this.rules.get(role);
  }

  hasNamespaceWriteAccess(namespaceId: string) {
    return this.isOrganizationAdminOrDeveloper || this.checkNamespaceAccess(namespaceId, ['namespace-admin']);
  }

  hasNamespaceReadAccess(namespaceId: string) {
    return this.isOrganizationViewer || this.checkNamespaceAccess(namespaceId, ['namespace-admin', 'namespace-viewer']);
  }

  canCreateContract(namespaceId: string) {
    return this.isOrganizationAdminOrDeveloper || this.hasNamespaceWriteAccess(namespaceId);
  }

  canCreateFeatureFlag(namespaceId: string) {
    return this.isOrganizationAdminOrDeveloper;
  }

  hasFeatureFlagWriteAccess(target: { namespaceId: string }) {
    return this.isOrganizationAdminOrDeveloper;
  }

  hasFeatureFlagReadAccess(target: { namespaceId: string }) {
    return this.isOrganizationViewer;
  }

  canCreateFederatedGraph(namespaceId: string) {
    if (this.isOrganizationAdminOrDeveloper) {
      return true;
    }

    const rule = this.ruleFor('graph-admin');
    if (!rule) {
      return false;
    }

    if (rule.namespaces.length === 0 && rule.resources.length === 0) {
      return true;
    } else if (rule.namespaces.length > 0) {
      return rule.namespaces.includes(namespaceId);
    }

    return false;
  }

  hasFederatedGraphWriteAccess(target: Target) {
    return this.isOrganizationAdminOrDeveloper || this.checkTargetAccess(target, ['graph-admin']);
  }

  hasFederatedGraphReadAccess(target: Target) {
    return this.isOrganizationViewer || this.checkTargetAccess(target, ['graph-admin', 'graph-viewer']);
  }

  canCreateSubGraph(namespaceId: string) {
    if (this.isOrganizationAdminOrDeveloper) {
      return true;
    }

    const rule = this.ruleFor('subgraph-admin');
    if (!rule) {
      return false;
    }

    if (rule.namespaces.length === 0 && rule.resources.length === 0) {
      return true;
    } else if (rule.namespaces.length > 0) {
      return rule.namespaces.includes(namespaceId);
    }

    return false;
  }

  hasSubGraphWriteAccess(target: Target) {
    return (
      this.isOrganizationAdminOrDeveloper || this.checkTargetAccess(target, ['subgraph-admin', 'subgraph-publisher'])
    );
  }

  hasSubGraphReadAccess(target: Target) {
    return this.isOrganizationViewer || this.hasSubGraphWriteAccess(target);
  }

  private checkNamespaceAccess(namespaceId: string, requiredRoles: OrganizationRole[]) {
    for (const role of requiredRoles) {
      const rule = this.ruleFor(role);
      if (!rule) {
        continue;
      }

      if (
        // The rule have access to every namespace
        rule.namespaces.length === 0 ||
        // The rule was given write access to the namespace
        (rule.namespaces.length > 0 && rule.namespaces.includes(namespaceId))
      ) {
        return true;
      }
    }

    return false;
  }

  private checkTargetAccess(target: Target, requiredRoles: OrganizationRole[]) {
    if (target.creatorUserId && this.userId && target.creatorUserId === this.userId) {
      // The target creator should always have access to the provided target
      return true;
    }

    for (const role of requiredRoles) {
      const rule = this.ruleFor(role);
      if (!rule) {
        continue;
      }

      if (
        // The rule have access to every resource
        (rule.namespaces.length === 0 && rule.resources.length === 0) ||
        // The rule was given write access to the namespace
        (rule.namespaces.length > 0 && rule.namespaces.includes(target.namespaceId)) ||
        // The rule was given write access to all resources
        rule.resources.length === 0 ||
        // The rule was given write access to the resource
        (rule.resources.length > 0 && rule.resources.includes(target.id))
      ) {
        return true;
      }
    }

    return false;
  }
}
