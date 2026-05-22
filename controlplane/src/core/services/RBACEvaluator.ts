import { OrganizationRole } from '../../db/models.js';
import { NamespaceAccess, OrganizationGroupDTO } from '../../types/index.js';
import { traced } from '../tracing.js';
import { isNamespaceAllowed } from '../util.js';

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

@traced
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
    readonly idpNamespaceAccess: NamespaceAccess = { kind: 'all' },
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

  private isAllowedByIdpGate(namespaceId: string): boolean {
    return isNamespaceAllowed(this.idpNamespaceAccess, namespaceId);
  }

  canDeleteNamespace(namespace: Namespace) {
    const baseAllowed =
      this.isOrganizationAdminOrDeveloper || this.checkNamespaceAccess(namespace, ['namespace-admin']);
    return baseAllowed && this.isAllowedByIdpGate(namespace.id);
  }

  hasNamespaceWriteAccess(namespace: Namespace) {
    const baseAllowed =
      this.isOrganizationAdminOrDeveloper || this.checkNamespaceAccess(namespace, ['namespace-admin']);
    return baseAllowed && this.isAllowedByIdpGate(namespace.id);
  }

  hasNamespaceReadAccess(namespace: Namespace) {
    const baseAllowed =
      this.isOrganizationViewer || this.checkNamespaceAccess(namespace, ['namespace-admin', 'namespace-viewer']);
    return baseAllowed && this.isAllowedByIdpGate(namespace.id);
  }

  canCreateContract(namespace: Namespace) {
    return this.canCreateFederatedGraph(namespace) && this.isAllowedByIdpGate(namespace.id);
  }

  canCreateFeatureFlag(namespace: Namespace) {
    return this.isOrganizationAdminOrDeveloper && this.isAllowedByIdpGate(namespace.id);
  }

  hasFeatureFlagWriteAccess(ff: FeatureFlag) {
    return this.isOrganizationAdminOrDeveloper && this.isAllowedByIdpGate(ff.namespaceId);
  }

  hasFeatureFlagReadAccess(ff: FeatureFlag) {
    return this.isOrganizationViewer && this.isAllowedByIdpGate(ff.namespaceId);
  }

  canCreateFederatedGraph(namespace: Namespace) {
    const baseAllowed =
      this.isOrganizationAdminOrDeveloper || this.hasRoleWithAccessToAllOrGivenNamespace('graph-admin', namespace.id);
    return baseAllowed && this.isAllowedByIdpGate(namespace.id);
  }

  canDeleteFederatedGraph(graph: Target) {
    const baseAllowed =
      this.isOrganizationAdminOrDeveloper ||
      this.isTargetOwnedByUser(graph) ||
      this.hasRoleWithAccessToAllOrGivenNamespace('graph-admin', graph.namespaceId);
    return baseAllowed && this.isAllowedByIdpGate(graph.namespaceId);
  }

  hasFederatedGraphWriteAccess(graph: Target) {
    const baseAllowed = this.isOrganizationAdminOrDeveloper || this.checkTargetAccess(graph, ['graph-admin']);
    return baseAllowed && this.isAllowedByIdpGate(graph.namespaceId);
  }

  hasFederatedGraphReadAccess(graph: Target) {
    const baseAllowed =
      this.isOrganizationViewer ||
      this.isOrganizationAdminOrDeveloper ||
      this.checkTargetAccess(graph, ['graph-admin']) ||
      this.checkTargetAccess(graph, ['graph-viewer']);
    return baseAllowed && this.isAllowedByIdpGate(graph.namespaceId);
  }

  canCreateSubGraph(namespace: Namespace) {
    const baseAllowed =
      this.isOrganizationAdminOrDeveloper ||
      this.hasRoleWithAccessToAllOrGivenNamespace('subgraph-admin', namespace.id);
    return baseAllowed && this.isAllowedByIdpGate(namespace.id);
  }

  canUpdateSubGraph(graph: Target) {
    const baseAllowed = this.isOrganizationAdminOrDeveloper || this.checkTargetAccess(graph, ['subgraph-admin']);
    return baseAllowed && this.isAllowedByIdpGate(graph.namespaceId);
  }

  canDeleteSubGraph(graph: Target) {
    const baseAllowed =
      this.isOrganizationAdminOrDeveloper ||
      this.isTargetOwnedByUser(graph) ||
      this.hasRoleWithAccessToAllOrGivenNamespace('subgraph-admin', graph.namespaceId);
    return baseAllowed && this.isAllowedByIdpGate(graph.namespaceId);
  }

  hasSubGraphWriteAccess(graph: Target) {
    const baseAllowed =
      this.isOrganizationAdminOrDeveloper || this.checkTargetAccess(graph, ['subgraph-admin', 'subgraph-publisher']);
    return baseAllowed && this.isAllowedByIdpGate(graph.namespaceId);
  }

  hasSubGraphCheckAccess(graph: Target) {
    const baseAllowed =
      this.isOrganizationAdminOrDeveloper ||
      this.checkTargetAccess(graph, ['subgraph-admin', 'subgraph-publisher']) ||
      this.checkTargetAccess(graph, ['subgraph-checker']);
    return baseAllowed && this.isAllowedByIdpGate(graph.namespaceId);
  }

  hasSubGraphReadAccess(graph: Target) {
    const baseAllowed =
      this.isOrganizationViewer ||
      this.isOrganizationAdminOrDeveloper ||
      this.checkTargetAccess(graph, ['subgraph-admin', 'subgraph-publisher']) ||
      this.checkTargetAccess(graph, ['subgraph-checker']) ||
      this.checkTargetAccess(graph, ['subgraph-viewer']);
    return baseAllowed && this.isAllowedByIdpGate(graph.namespaceId);
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
