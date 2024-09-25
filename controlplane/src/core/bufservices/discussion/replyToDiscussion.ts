import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ReplyToDiscussionRequest,
  ReplyToDiscussionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DiscussionRepository } from '../../repositories/DiscussionRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function replyToDiscussion(
  opts: RouterOptions,
  req: ReplyToDiscussionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ReplyToDiscussionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ReplyToDiscussionResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);

    const canAccessDiscussion = await discussionRepo.canAccessDiscussion(req.discussionId);
    if (!canAccessDiscussion) {
      return {
        response: {
          code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
          details: 'You are not authorized to view or modify this discussion',
        },
      };
    }

    const isResolved = await discussionRepo.isResolved(req.discussionId);
    if (isResolved) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'You cannot reply to a resolved discussion',
        },
      };
    }

    await discussionRepo.replyToDiscussion({
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
