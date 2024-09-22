import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteDiscussionCommentRequest,
  DeleteDiscussionCommentResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DiscussionRepository } from '../../repositories/DiscussionRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function deleteDiscussionComment(
  opts: RouterOptions,
  req: DeleteDiscussionCommentRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteDiscussionCommentResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteDiscussionCommentResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db);

    const canAccessDiscussion = await discussionRepo.canAccessDiscussion(req.discussionId);
    if (!canAccessDiscussion) {
      return {
        response: {
          code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
          details: 'You are not authorized to view or modify this discussion',
        },
      };
    }

    const comment = await discussionRepo.getCommentById(req.commentId);
    if (!comment) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'The comment could not be found',
        },
      };
    }

    const userRoles = await orgRepo.getOrganizationMemberRoles({
      userID: authContext.userId || '',
      organizationID: authContext.organizationId,
    });

    if (!(comment.createdById === authContext.userId || userRoles.includes('admin'))) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `You are not authorized to delete this comment'`,
        },
      };
    }

    const success = await discussionRepo.deleteComment({
      ...req,
    });

    if (!success) {
      return {
        response: {
          code: EnumStatusCode.ERR,
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
