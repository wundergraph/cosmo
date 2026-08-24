import { ServiceImpl } from '@connectrpc/connect';
import { AIService } from '@wundergraph/cosmo-connect/dist/ai/v1/ai_pb';
import type { RouterOptions } from '../routes.js';
import { PromptToQueryService } from '../services/PromptToQueryService.js';
import { enrichLogger, getLogger, handleError } from '../util.js';

export default function (opts: RouterOptions): Partial<ServiceImpl<typeof AIService>> {
  return {
    generateQuery(req, ctx) {
      let logger = getLogger(ctx, opts.logger);
      return handleError(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticateRouter(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const promptToQueryService = new PromptToQueryService(
          opts.db,
          logger,
          opts.promptToQueryServiceAddress,
          authContext.organizationId,
          opts.billingDefaultPlanId,
        );

        return promptToQueryService.generateQuery(req.schemaHash, req.prompt);
      });
    },
  };
}
