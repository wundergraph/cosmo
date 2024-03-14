import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { AuthorizationError } from '../errors/errors.js';
import { ApiKeyRepository } from '../repositories/ApiKeyRepository.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { AuthContext } from '../../types/index.js';

export class Authorization {
  constructor(
    private logger: FastifyBaseLogger,
    private defaultBillingPlanId?: string,
  ) {}

  /**
   * Authorize a user.
   * The function will check if the user has permissions to perform the action.
   */
  public async authorize({
    headers,
    graph,
    db,
    authContext,
  }: {
    headers: Headers;
    graph: {
      name: string;
      targetId: string;
      targetType: 'subgraph' | 'federatedGraph';
    };
    db: PostgresJsDatabase<typeof schema>;
    authContext: AuthContext;
  }) {
    try {
      const { targetId, targetType } = graph;
      const { userId, organizationId, isAdmin } = authContext;

      const orgRepo = new OrganizationRepository(db, this.defaultBillingPlanId);
      const fedRepo = new FederatedGraphRepository(this.logger, db, organizationId);
      const subgraphRepo = new SubgraphRepository(this.logger, db, organizationId);
      const apiKeyRepo = new ApiKeyRepository(db);

      const authorization = headers.get('authorization');
      const token = authorization?.replace(/^bearer\s+/i, '');

      const organization = await orgRepo.byId(organizationId);
      if (!organization) {
        throw new Error('Organization not found');
      }

      // checking if rbac is enabled, if not return
      const rbacEnabled = await orgRepo.isFeatureEnabled(organization.id, 'rbac');
      if (!rbacEnabled) {
        return;
      }

      // we verify the permissions of the api key only if rbac is enabled
      // first dealing with api keys
      if (token && token.startsWith('cosmo')) {
        const verified = await apiKeyRepo.verifyAPIKeyPermissions({ apiKey: token, accessedTargetId: targetId });
        if (verified) {
          return;
        } else {
          throw new AuthorizationError(EnumStatusCode.ERROR_NOT_AUTHORIZED, 'Not authorized');
        }
      }

      // an admin is authorized to perform all the actions
      if (isAdmin) {
        return;
      }

      if (targetType === 'federatedGraph') {
        const fedGraph = await fedRepo.byTargetId(targetId);
        if (!(fedGraph?.creatorUserId && fedGraph.creatorUserId === userId)) {
          throw new AuthorizationError(EnumStatusCode.ERROR_NOT_AUTHORIZED, 'Not authorized');
        }
      } else {
        const subgraph = await subgraphRepo.byTargetId(targetId);
        const subgraphMembers = await subgraphRepo.getSubgraphMembersByTargetId(targetId);
        const userIds = subgraphMembers.map((s) => s.userId);

        if (!((subgraph?.creatorUserId && subgraph.creatorUserId === userId) || userIds.includes(userId))) {
          throw new AuthorizationError(EnumStatusCode.ERROR_NOT_AUTHORIZED, 'Not authorized');
        }
      }
    } catch {
      throw new AuthorizationError(
        EnumStatusCode.ERROR_NOT_AUTHENTICATED,
        'You are not authorized to perform the current action as RBAC is enabled. Please communicate with the organization admin to gain access.',
      );
    }
  }
}
