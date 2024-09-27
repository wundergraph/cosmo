import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateDiscussionCommentRequest,
  UpdateDiscussionCommentResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DiscussionRepository } from '../../repositories/DiscussionRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function updateDiscussionComment(
  opts: RouterOptions,
  req: UpdateDiscussionCommentRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateDiscussionCommentResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateDiscussionCommentResponse>>(ctx, logger, async () => {
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
    const updated = await discussionRepo.updateComment({
      ...req,
      createdById: authContext.userId,
    });

    if (updated.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Failed to update comment',
        },
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
