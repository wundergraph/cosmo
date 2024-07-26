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
   * It must be called after the user is authenticated and always before a federated graph or subgraph action.
   */
  public async authorize({
    headers,
    graph,
    db,
    authContext,
  }: {
    headers: Headers;
    graph: {
      targetId: string;
      targetType: 'subgraph' | 'federatedGraph';
    };
    db: PostgresJsDatabase<typeof schema>;
    authContext: AuthContext;
  }) {
    const { targetId, targetType } = graph;
    const { userId, organizationId, isAdmin } = authContext;

    const orgRepo = new OrganizationRepository(this.logger, db, this.defaultBillingPlanId);
    const fedRepo = new FederatedGraphRepository(this.logger, db, organizationId);
    const subgraphRepo = new SubgraphRepository(this.logger, db, organizationId);
    const apiKeyRepo = new ApiKeyRepository(db);

    const authorization = headers.get('authorization');
    const token = authorization?.replace(/^bearer\s+/i, '');

    const org = await orgRepo.byId(organizationId);
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }
    if (org.deactivation) {
      throw new Error(`The organization is deactivated and is in read-only mode`);
    }

    /**
     * We check if the organization has the rbac feature enabled.
     * If it is not enabled, we return because the user is authorized to perform all the actions.
     * This only works because we validate before if the user has write access to the organization.
     * @TODO: Move hasWriteAccess check to the Authorization service.
     */
    const rbacEnabled = await orgRepo.isFeatureEnabled(organizationId, 'rbac');
    if (!rbacEnabled) {
      return;
    }

    try {
      /**
       * If the user is using an API key, we verify if the API key has access to the resource.
       * We only do this because RBAC is enabled otherwise the key is handled as an admin key.
       */
      if (token && token.startsWith('cosmo')) {
        const verified = await apiKeyRepo.verifyAPIKeyResources({ apiKey: token, accessedTargetId: targetId });
        if (verified) {
          return;
        } else {
          throw new AuthorizationError(EnumStatusCode.ERROR_NOT_AUTHORIZED, 'Not authorized');
        }
      }

      /**
       * An admin is authorized to perform all the actions even if RBAC is enabled.
       */
      if (isAdmin) {
        return;
      }

      /**
       * We check if the user has access to the resource.
       */

      if (targetType === 'federatedGraph') {
        const fedGraph = await fedRepo.byTargetId(targetId);
        if (!(fedGraph?.creatorUserId && fedGraph.creatorUserId === userId)) {
          throw new Error('User is not authorized to perform the current action in the federated graph');
        }
      } else if (targetType === 'subgraph') {
        const subgraph = await subgraphRepo.byTargetId(targetId);
        const subgraphMembers = await subgraphRepo.getSubgraphMembersByTargetId(targetId);
        const userIds = subgraphMembers.map((s) => s.userId);

        if (!((subgraph?.creatorUserId && subgraph.creatorUserId === userId) || userIds.includes(userId))) {
          throw new Error(
            'User is not authorized to perform the current action in the federated graph because the user is not a member of the subgraph',
          );
        }
      } else {
        throw new Error('User is not authorized to perform the current action as the target type is not supported');
      }
    } catch (err: any) {
      this.logger.error(err, 'User is not authorized to perform the current action as RBAC is enabled.');

      throw new AuthorizationError(
        EnumStatusCode.ERROR_NOT_AUTHORIZED,
        'You are not authorized to perform the current action as RBAC is enabled. Please communicate with the organization admin to gain access.',
      );
    }
  }
}
