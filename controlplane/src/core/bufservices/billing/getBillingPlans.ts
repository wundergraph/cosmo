import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetBillingPlansRequest,
  GetBillingPlansResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FastifyBaseLogger } from 'fastify';
import { BillingRepository } from '../../repositories/BillingRepository.js';
import type { RouterOptions } from '../../routes.js';
import { handleError } from '../../util.js';

export function getBillingPlans(
  opts: RouterOptions,
  req: GetBillingPlansRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetBillingPlansResponse>> {
  const logger = ctx.values.get<FastifyBaseLogger>({ id: Symbol('logger'), defaultValue: opts.logger });

  return handleError<PlainMessage<GetBillingPlansResponse>>(ctx, logger, async () => {
    const billingRepo = new BillingRepository(opts.db);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      plans: await billingRepo.listPlans(),
    };
  });
}
