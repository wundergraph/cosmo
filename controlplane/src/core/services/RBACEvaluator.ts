import { OrganizationRole } from "../../db/models.js";
import { FederatedGraphDTO, OrganizationGroupDTO } from "../../types/index.js";

export class RBACEvaluator {
  is(roles: OrganizationRole[]) {
    return false;
  }

  canAccessFederatedGraph(fedGraph: FederatedGraphDTO, rolesToBe?: OrganizationRole[]) {
    return false;
  }
}