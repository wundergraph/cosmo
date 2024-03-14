import { PlainMessage } from '@bufbuild/protobuf';
import { ServiceImpl } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import {
  GetConfigResponse,
  RegistrationInfo,
  SelfRegisterResponse,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { lru } from 'tiny-lru';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../routes.js';
import { enrichLogger, getLogger, handleError } from '../util.js';

export default function (opts: RouterOptions): Partial<ServiceImpl<typeof NodeService>> {
  const registrationInfoCache = lru<PlainMessage<RegistrationInfo>>(1000, 300_000);
  return {
    selfRegister: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<SelfRegisterResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticateRouter(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(opts.db, opts.billingDefaultPlanId);
        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        const cachedInfo = registrationInfoCache.get(authContext.federatedGraphId);
        if (cachedInfo) {
          return {
            response: {
              code: EnumStatusCode.OK,
            },
            registrationInfo: cachedInfo,
          };
        }

        const publicKey = await fedRepo.getGraphPublicKey({
          federatedGraphId: authContext.federatedGraphId,
          organizationId: authContext.organizationId,
        });

        if (!publicKey) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Graph public key not found',
            },
          };
        }

        const features = await orgRepo.getOrganizationFeatures({
          organizationID: authContext.organizationId,
        });

        const registrationInfo: PlainMessage<RegistrationInfo> = {
          accountLimits: {
            traceSamplingRate: (features['trace-sampling-rate'] as number) ?? 0.1,
          },
          graphPublicKey: publicKey,
        };

        registrationInfoCache.set(authContext.federatedGraphId, registrationInfo);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          registrationInfo,
        };
      });
    },

    // TODO: Delete RPC after a few weeks, after the new router has been released without controlplane support
    // Controlplane was no longer used as primary router config serving mechanism since 0.59.0 2024-02-05
    getLatestValidRouterConfig: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetConfigResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticateRouter(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        const federatedGraph = await fedGraphRepo.byId(authContext.federatedGraphId);

        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Federated graph not found',
            },
          };
        }

        // Avoid downloading the config to check if it's the latest version
        if (req.version) {
          const isLatestVersion = await fedGraphRepo.isLatestValidSchemaVersion(federatedGraph.targetId, req.version);

          if (isLatestVersion) {
            return {
              response: {
                code: EnumStatusCode.OK,
              },
            };
          }
        }

        // Now, download the config and return it
        const routerConfig = await fedGraphRepo.getLatestValidRouterConfig(federatedGraph.targetId);

        if (!routerConfig) {
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
            subgraphs: routerConfig.config.subgraphs,
            engineConfig: routerConfig.config.engineConfig,
            version: routerConfig.schemaVersionId,
          },
        };
      });
    },
  };
}
