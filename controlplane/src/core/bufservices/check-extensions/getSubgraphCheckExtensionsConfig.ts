import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetSubgraphCheckExtensionsConfigResponse,
  GetSubgraphCheckExtensionsConfigRequest,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { SubgraphCheckExtensionsRepository } from '../../repositories/SubgraphCheckExtensionsRepository.js';

export function getSubgraphCheckExtensionsConfig(
  opts: RouterOptions,
  req: GetSubgraphCheckExtensionsConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetSubgraphCheckExtensionsConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetSubgraphCheckExtensionsConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const organizationRepo = new OrganizationRepository(logger, opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    const subgraphCheckExtensionsFeature = await organizationRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'subgraph-check-extensions',
    });

    if (!subgraphCheckExtensionsFeature?.enabled) {
      return {
        response: {
          code: EnumStatusCode.ERR_UPGRADE_PLAN,
          details: 'Upgrade to enterprise plan to enable subgraph check extensions',
        },
        isEnabledForNamespace: false,
        endpoint: '',
        isSecretKeyAssigned: false,
        includeComposedSdl: false,
        includeLintingIssues: false,
        includePruningIssues: false,
        includeSchemaChanges: false,
        includeAffectedOperations: false,
      };
    }

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
        isEnabledForNamespace: false,
        endpoint: '',
        isSecretKeyAssigned: false,
        includeComposedSdl: false,
        includeLintingIssues: false,
        includePruningIssues: false,
        includeSchemaChanges: false,
        includeAffectedOperations: false,
      };
    }

    if (!authContext.rbac.hasNamespaceReadAccess(namespace)) {
      throw new UnauthorizedError();
    }

    const sceRepo = new SubgraphCheckExtensionsRepository(opts.db);
    const config = await sceRepo.getNamespaceConfig(namespace.id);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      isEnabledForNamespace: namespace.enableSubgraphCheckExtensions,
      endpoint: config.endpoint,
      isSecretKeyAssigned: !!config.secretKey.trim(),
      includeComposedSdl: config.includeComposedSdl,
      includeLintingIssues: config.includeLintingIssues,
      includePruningIssues: config.includePruningIssues,
      includeSchemaChanges: config.includeSchemaChanges,
      includeAffectedOperations: config.includeAffectedOperations,
    };
  });
}
