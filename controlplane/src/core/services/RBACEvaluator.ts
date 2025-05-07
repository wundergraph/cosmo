import { OrganizationRole } from '../../db/models.js';
import { FederatedGraphDTO, OrganizationGroupDTO } from '../../types/index.js';

export class RBACEvaluator {
  private readonly roles: OrganizationRole[];

  constructor(groups: Omit<OrganizationGroupDTO, 'membersCount' | 'kcGroupId' | 'kcMapperId'>[]) {
    const allRules = groups.flatMap((group) => group.rules.map((rule) => rule));
    const rulesGroupedByRoles = Object.groupBy(allRules, (rule) => rule.role);

    this.roles = Object.keys(rulesGroupedByRoles) as OrganizationRole[];
  }

  is(roles: OrganizationRole[]) {
    for (const role of roles) {
      if (this.roles.includes(role)) {
        return true;
      }
    }

    return false;
  }

  canAccessFederatedGraph(fedGraph: FederatedGraphDTO, rolesToBe?: OrganizationRole[]) {
    return false;
  }
}
