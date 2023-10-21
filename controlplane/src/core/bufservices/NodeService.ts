import { ServiceImpl } from '@connectrpc/connect';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import { PlainMessage } from '@bufbuild/protobuf';
import { GetConfigResponse } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { handleError } from '../util.js';
import type { RouterOptions } from '../routes.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';

export default function (opts: RouterOptions): Partial<ServiceImpl<typeof NodeService>> {
  return {
    getLatestValidRouterConfig: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetConfigResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticateRouter(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

        const federatedGraph = await fedGraphRepo.byName(req.graphName);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Federated graph not found',
            },
          };
        }

        if (req.version) {
          const isLatest = federatedGraph.schemaVersionId === req.version;
          if (isLatest) {
            return {
              response: {
                code: EnumStatusCode.OK,
              },
            };
          }
        }

        const config = await fedGraphRepo.getLatestValidRouterConfig(federatedGraph?.targetId);
        if (!config) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'No valid router config found',
            },
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          config: {
            subgraphs: config.config.subgraphs,
            engineConfig: config.config.engineConfig,
            version: config.version,
          },
        };
      });
    },
  };
}
