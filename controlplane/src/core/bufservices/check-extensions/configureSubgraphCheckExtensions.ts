import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ConfigureSubgraphCheckExtensionsRequest,
  ConfigureSubgraphCheckExtensionsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { SubgraphCheckExtensionsRepository } from '../../repositories/SubgraphCheckExtensionsRepository.js';

export function configureSubgraphCheckExtensions(
  opts: RouterOptions,
  req: ConfigureSubgraphCheckExtensionsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ConfigureSubgraphCheckExtensionsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ConfigureSubgraphCheckExtensionsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    return opts.db.transaction(async (tx) => {
      const organizationRepo = new OrganizationRepository(logger, tx);
      const namespaceRepo = new NamespaceRepository(tx, authContext.organizationId);

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
        };
      }

      const namespace = await namespaceRepo.byName(req.namespace);
      if (!namespace) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Namespace '${req.namespace}' not found`,
          },
        };
      }

      if (!authContext.rbac.hasNamespaceReadAccess(namespace)) {
        throw new UnauthorizedError();
      }

      await namespaceRepo.updateConfiguration({
        id: namespace.id,
        enableSubgraphCheckExtensions: req.enableSubgraphCheckExtensions,
      });

      const checkExtensionsRepo = new SubgraphCheckExtensionsRepository(tx);
      if (req.enableSubgraphCheckExtensions) {
        // When the check extension is enabled, we want all data to be included, the user can disable what they don't
        // need later on
        const forceEnableIncludedData = !namespace.enableSubgraphCheckExtensions;

        await checkExtensionsRepo.updateNamespaceConfig({
          namespaceId: namespace.id,
          endpoint: req.endpoint,
          secretKey: req.secretKey,
          includeComposedSdl: forceEnableIncludedData || req.includeComposedSdl,
          includeLintingIssues: forceEnableIncludedData || req.includeLintingIssues,
          includePruningIssues: forceEnableIncludedData || req.includePruningIssues,
          includeSchemaChanges: forceEnableIncludedData || req.includeSchemaChanges,
          includeAffectedOperations: forceEnableIncludedData || req.includeAffectedOperations,
        });
      } else {
        await checkExtensionsRepo.deleteNamespaceConfig(namespace.id);
      }

      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    });
  });
}
