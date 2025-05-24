import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { UpgradePlanRequest, UpgradePlanResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { BillingRepository } from '../../repositories/BillingRepository.js';
import type { RouterOptions } from '../../routes.js';
import { BillingService } from '../../services/BillingService.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function upgradePlan(
  opts: RouterOptions,
  req: UpgradePlanRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpgradePlanResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpgradePlanResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const billingRepo = new BillingRepository(opts.db);
    const billingService = new BillingService(opts.db, billingRepo);
    const auditLogRepository = new AuditLogRepository(opts.db);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    if (!opts.stripeSecretKey) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Billing is not enabled. Please contact support.',
        },
      };
    }

    const plan = await billingRepo.getPlanById(req.plan);
    if (!plan) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Plan not found',
        },
      };
    }

    await billingService.upgradePlan({
      organizationId: authContext.organizationId,
      planId: plan.id,
    });

    await auditLogRepository.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'subscription.upgraded',
      action: 'upgraded',
      auditableType: 'subscription',
      auditableDisplayName: plan.name,
      actorDisplayName: 'cosmo-bot',
      actorType: 'system',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
