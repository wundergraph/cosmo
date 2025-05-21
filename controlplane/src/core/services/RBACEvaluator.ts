import { OrganizationRole } from '../../db/models.js';
import { OrganizationGroupDTO } from '../../types/index.js';

interface RuleData {
  namespaces: string[];
  resources: string[];
}

interface Namespace {
  id: string;
  createdBy?: string;
}

interface FeatureFlag {
  namespaceId: string;
}

interface Target {
  id: string;
  namespaceId: string;
  creatorUserId?: string;
}

export class RBACEvaluator {
  private readonly isRBACFeatureEnabled: boolean;
  readonly roles: OrganizationRole[];
  private readonly rules: ReadonlyMap<OrganizationRole, RuleData>;

  readonly namespaces: string[];
  readonly resources: string[];

  readonly isOrganizationAdmin: boolean;
  readonly isOrganizationAdminOrDeveloper: boolean;
  readonly isOrganizationApiKeyManager: boolean;
  readonly isOrganizationViewer: boolean;

  readonly canCreateNamespace: boolean;

  constructor(
    readonly groups: Omit<OrganizationGroupDTO, 'membersCount'>[],
    private readonly userId?: string,
    isRBACFeatureEnabled?: boolean,
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

    this.isRBACFeatureEnabled = isRBACFeatureEnabled ?? true;
    this.roles = Array.from(result.keys(), (k) => k);
    this.namespaces = [...new Set(Array.from(result.values(), (res) => res.namespaces).flat())];
    this.resources = [...new Set(Array.from(result.values(), (res) => res.resources).flat())];
    this.rules = result;

    this.isOrganizationAdmin = this.roles.includes('organization-admin');
    this.isOrganizationAdminOrDeveloper = this.isOrganizationAdmin || this.roles.includes('organization-developer');
    this.isOrganizationApiKeyManager = this.isRBACFeatureEnabled
      ? this.isOrganizationAdmin || !!this.ruleFor('organization-apikey-manager')
      : this.isOrganizationAdmin;
    this.isOrganizationViewer = this.isOrganizationAdminOrDeveloper || this.roles.includes('organization-viewer');

    this.canCreateNamespace =
      this.isOrganizationAdminOrDeveloper || this.ruleFor('namespace-admin')?.namespaces.length === 0;
  }

  ruleFor(role: OrganizationRole): RuleData | undefined {
    return this.rules.get(role);
  }

  canDeleteNamespace(namespace: Namespace) {
    return this.isOrganizationAdminOrDeveloper || this.checkNamespaceAccess(namespace, ['namespace-admin']);
  }

  hasNamespaceWriteAccess(namespace: Namespace) {
    return this.isOrganizationAdminOrDeveloper || this.checkNamespaceAccess(namespace, ['namespace-admin']);
  }

  hasNamespaceReadAccess(namespace: Namespace) {
    return this.isOrganizationViewer || this.checkNamespaceAccess(namespace, ['namespace-admin', 'namespace-viewer']);
  }

  canCreateContract(namespace: Namespace) {
    return this.canCreateFederatedGraph(namespace);
  }

  canCreateFeatureFlag(namespace: Namespace) {
    return this.isOrganizationAdminOrDeveloper;
  }

  hasFeatureFlagWriteAccess(featureFlag: FeatureFlag) {
    return this.isOrganizationAdminOrDeveloper;
  }

  hasFeatureFlagReadAccess(featureFlag: FeatureFlag) {
    return this.isOrganizationViewer;
  }

  canCreateFederatedGraph(namespace: Namespace) {
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
      return rule.namespaces.includes(namespace.id);
    }

    return false;
  }

  hasFederatedGraphWriteAccess(graph: Target) {
    return this.isOrganizationAdminOrDeveloper || this.checkTargetAccess(graph, ['graph-admin']);
  }

  hasFederatedGraphReadAccess(graph: Target) {
    return this.isOrganizationViewer || this.checkTargetAccess(graph, ['graph-admin', 'graph-viewer']);
  }

  canCreateSubGraph(namespace: Namespace) {
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
      return rule.namespaces.includes(namespace.id);
    }

    return false;
  }

  hasSubGraphWriteAccess(graph: Target) {
    return (
      this.isOrganizationAdminOrDeveloper || this.checkTargetAccess(graph, ['subgraph-admin', 'subgraph-publisher'])
    );
  }

  hasSubGraphReadAccess(graph: Target) {
    return this.isOrganizationViewer || this.hasSubGraphWriteAccess(graph);
  }

  private checkNamespaceAccess(ns: Namespace, requiredRoles: OrganizationRole[]) {
    if (ns.createdBy && this.userId && ns.createdBy === this.userId) {
      // The namespace creator should always have access to the provided namespace
    }

    for (const role of requiredRoles) {
      const rule = this.ruleFor(role);
      if (!rule) {
        continue;
      }

      if (
        // The rule have access to every namespace
        rule.namespaces.length === 0 ||
        // The rule was given write access to the namespace
        (rule.namespaces.length > 0 && rule.namespaces.includes(ns.id))
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
