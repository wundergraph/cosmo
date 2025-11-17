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
  targetId: string;
  namespaceId: string;
  creatorUserId?: string;
}

export class RBACEvaluator {
  readonly isApiKey: boolean;
  /**
   * A legacy API key is an API key which have not been migrated to use groups.
   *
   * The reason for this is that old API keys effectively had admin access.
   */
  private readonly isLegacyApiKey: boolean;
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
    readonly groups: Omit<OrganizationGroupDTO, 'membersCount' | 'apiKeysCount'>[],
    private readonly userId?: string,
    isApiKey?: boolean,
  ) {
    this.isApiKey = !!isApiKey;
    this.isLegacyApiKey = this.isApiKey && groups.length === 0;

    this.roles = [];
    this.namespaces = [];
    this.resources = [];
    this.rules = new Map<OrganizationRole, RuleData>();

    if (!this.isLegacyApiKey) {
      // Only evaluate the rules if the user is not a legacy API key
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

    this.isOrganizationAdmin = this.isLegacyApiKey || this.roles.includes('organization-admin');
    this.isOrganizationAdminOrDeveloper = this.isOrganizationAdmin || this.roles.includes('organization-developer');
    this.isOrganizationApiKeyManager = this.isOrganizationAdmin || !!this.ruleFor('organization-apikey-manager');
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

  canCreateFeatureFlag(_: Namespace) {
    return this.isOrganizationAdminOrDeveloper;
  }

  hasFeatureFlagWriteAccess(_: FeatureFlag) {
    return this.isOrganizationAdminOrDeveloper;
  }

  hasFeatureFlagReadAccess(_: FeatureFlag) {
    return this.isOrganizationViewer;
  }

  canCreateFederatedGraph(namespace: Namespace) {
    return (
      this.isOrganizationAdminOrDeveloper || this.hasRoleWithAccessToAllOrGivenNamespace('graph-admin', namespace.id)
    );
  }

  canDeleteFederatedGraph(graph: Target) {
    return (
      this.isOrganizationAdminOrDeveloper ||
      this.isTargetOwnedByUser(graph) ||
      this.hasRoleWithAccessToAllOrGivenNamespace('graph-admin', graph.namespaceId)
    );
  }

  hasFederatedGraphWriteAccess(graph: Target) {
    return this.isOrganizationAdminOrDeveloper || this.checkTargetAccess(graph, ['graph-admin']);
  }

  hasFederatedGraphReadAccess(graph: Target) {
    return (
      this.isOrganizationViewer ||
      this.hasFederatedGraphWriteAccess(graph) ||
      this.checkTargetAccess(graph, ['graph-viewer'])
    );
  }

  canCreateSubGraph(namespace: Namespace) {
    return (
      this.isOrganizationAdminOrDeveloper || this.hasRoleWithAccessToAllOrGivenNamespace('subgraph-admin', namespace.id)
    );
  }

  canUpdateSubGraph(graph: Target) {
    return this.isOrganizationAdminOrDeveloper || this.checkTargetAccess(graph, ['subgraph-admin']);
  }

  canDeleteSubGraph(graph: Target) {
    return (
      this.isOrganizationAdminOrDeveloper ||
      this.isTargetOwnedByUser(graph) ||
      this.hasRoleWithAccessToAllOrGivenNamespace('subgraph-admin', graph.namespaceId)
    );
  }

  hasSubGraphWriteAccess(graph: Target) {
    return (
      this.isOrganizationAdminOrDeveloper || this.checkTargetAccess(graph, ['subgraph-admin', 'subgraph-publisher'])
    );
  }

  hasSubGraphCheckAccess(graph: Target) {
    return this.hasSubGraphWriteAccess(graph) || this.checkTargetAccess(graph, ['subgraph-checker']);
  }

  hasSubGraphReadAccess(graph: Target) {
    return (
      this.isOrganizationViewer ||
      this.hasSubGraphCheckAccess(graph) ||
      this.checkTargetAccess(graph, ['subgraph-viewer'])
    );
  }

  private hasRoleWithAccessToAllOrGivenNamespace(role: OrganizationRole, namespaceId: string) {
    const rule = this.ruleFor(role);
    return (
      !!rule &&
      // The rule has access to every namespace
      ((rule.namespaces.length === 0 && rule.resources.length === 0) ||
        // The rule has access to the given namespace
        (rule.namespaces.length > 0 && rule.namespaces.includes(namespaceId)))
    );
  }

  private checkNamespaceAccess(ns: Namespace, requiredRoles: OrganizationRole[]) {
    if (!this.isApiKey && ns.createdBy && this.userId && ns.createdBy === this.userId) {
      // The namespace creator should always have access to the provided namespace
      return true;
    }

    for (const role of requiredRoles) {
      const rule = this.ruleFor(role);
      if (!rule) {
        continue;
      }

      if (
        // The rule has access to every namespace
        rule.namespaces.length === 0 ||
        // The rule was given write access to the namespace
        (rule.namespaces.length > 0 && rule.namespaces.includes(ns.id))
      ) {
        return true;
      }
    }

    return false;
  }

  private isTargetOwnedByUser(target: Target) {
    return !this.isApiKey && target.creatorUserId && this.userId && target.creatorUserId === this.userId;
  }

  private checkTargetAccess(target: Target, requiredRoles: OrganizationRole[]) {
    if (!this.isApiKey && target.creatorUserId && this.userId && target.creatorUserId === this.userId) {
      // The target creator should always have access to the provided target
      return true;
    }

    for (const role of requiredRoles) {
      const rule = this.ruleFor(role);
      if (!rule) {
        continue;
      }

      if (
        // The rule has access to every resource
        (rule.namespaces.length === 0 && rule.resources.length === 0) ||
        // The rule was given access to the namespace
        (rule.namespaces.length > 0 && rule.namespaces.includes(target.namespaceId)) ||
        // The rule was given write access to the resource
        (rule.resources.length > 0 && rule.resources.includes(target.targetId))
      ) {
        return true;
      }
    }

    return false;
  }
}
