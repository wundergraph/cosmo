import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetFederatedGraphSDLByNameRequest,
  GetFederatedGraphSDLByNameResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getFederatedGraphSDLByName(
  opts: RouterOptions,
  req: GetFederatedGraphSDLByNameRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFederatedGraphSDLByNameResponse>> {
  let logger = getLogger(ctx, opts.logger);
  return handleError<PlainMessage<GetFederatedGraphSDLByNameResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
      };
    }

    const federatedGraph = await fedRepo.byName(req.name, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'The requested federated graph was not found',
        },
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const schemaVersion = await fedRepo.getLatestValidSchemaVersion({ targetId: federatedGraph.targetId });

    if (!schemaVersion || !schemaVersion.schema) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
        },
      };
    }

    if (req.featureFlagName) {
      const featureFlag = await featureFlagRepo.getFeatureFlagByName({
        featureFlagName: req.featureFlagName,
        namespaceId: namespace.id,
      });
      if (!featureFlag) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Feature flag ${req.featureFlagName} not found`,
          },
        };
      }

      const ffSchemaVersion = await featureFlagRepo.getFeatureFlagSchemaVersionByBaseSchemaVersion({
        baseSchemaVersionId: schemaVersion.schemaVersionId,
        featureFlagId: featureFlag.id,
      });
      if (!ffSchemaVersion || !ffSchemaVersion.schema) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
          },
        };
      }
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        sdl: ffSchemaVersion.schema,
        clientSchema: ffSchemaVersion.clientSchema || undefined,
        versionId: ffSchemaVersion.schemaVersionId,
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      sdl: schemaVersion.schema,
      clientSchema: schemaVersion.clientSchema || undefined,
      versionId: schemaVersion.schemaVersionId,
    };
  });
}
