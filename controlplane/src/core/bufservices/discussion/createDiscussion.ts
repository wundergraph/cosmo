import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateDiscussionRequest,
  CreateDiscussionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DiscussionRepository } from '../../repositories/DiscussionRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function createDiscussion(
  opts: RouterOptions,
  req: CreateDiscussionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateDiscussionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateDiscussionResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);

    const canCreateDiscussion = await discussionRepo.canAccessTarget(req.targetId);
    if (!canCreateDiscussion) {
      return {
        response: {
          code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
          details: 'You are not authorized to create a discussion in this graph',
        },
      };
    }

    await discussionRepo.createDiscussion({
      ...req,
      createdById: authContext.userId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
