import { ServiceImpl } from '@connectrpc/connect';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import { PlainMessage } from '@bufbuild/protobuf';
import { lru } from 'tiny-lru';
import {
  GetConfigResponse,
  RegistrationInfo,
  SelfRegisterResponse,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { handleError } from '../util.js';
import type { RouterOptions } from '../routes.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';

export default function (opts: RouterOptions): Partial<ServiceImpl<typeof NodeService>> {
  const registrationInfoCache = lru<PlainMessage<RegistrationInfo>>(1000, 300_000);
  return {
    selfRegister: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<SelfRegisterResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticateRouter(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);
        const fedRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

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

        const org = await orgRepo.getOrganizationLimits({
          organizationID: authContext.organizationId,
        });

        const registrationInfo: PlainMessage<RegistrationInfo> = {
          accountLimits: {
            traceSamplingRate: org.traceSamplingRateLimit,
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
    getLatestValidRouterConfig: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetConfigResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticateRouter(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

        const target = await fedGraphRepo.targetByName(req.graphName);
        if (!target) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Federated graph not found',
            },
          };
        }

        // Avoid downloading the config to check if it's the latest version
        if (req.version) {
          const isLatestVersion = await fedGraphRepo.isLatestValidSchemaVersion(target.id, req.version);

          if (isLatestVersion) {
            return {
              response: {
                code: EnumStatusCode.OK,
              },
            };
          }
        }

        // Now, download the config and return it
        const routerConfig = await fedGraphRepo.getLatestValidRouterConfig(target?.id);

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
