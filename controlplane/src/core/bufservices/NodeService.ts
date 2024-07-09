import { PlainMessage } from '@bufbuild/protobuf';
import { ServiceImpl } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import { RegistrationInfo, SelfRegisterResponse } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
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

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
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
  };
}
