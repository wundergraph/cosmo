import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
    GetDiscussionRequest,
    GetDiscussionResponse
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DiscussionRepository } from '../../repositories/DiscussionRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getDiscussion(
  opts: RouterOptions,
  req: GetDiscussionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetDiscussionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetDiscussionResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);

    const exists = await discussionRepo.exists(req.discussionId);
    if (!exists) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Could not find discussion',
        },
        comments: [],
      };
    }

    const canAccessDiscussion = await discussionRepo.canAccessDiscussion(req.discussionId);
    if (!canAccessDiscussion) {
      return {
        response: {
          code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
          details: 'You are not authorized to view or modify this discussion',
        },
        comments: [],
      };
    }

    const graphDiscussion = await discussionRepo.byId(req.discussionId);

    if (!graphDiscussion) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Discussion not found`,
        },
        comments: [],
      };
    }

    const comments = graphDiscussion.thread.map((t) => ({
      id: t.id,
      contentJson: t.contentJson ? JSON.stringify(t.contentJson) : '',
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt?.toISOString(),
      createdBy: t.createdById ?? undefined,
      isDeleted: t.isDeleted,
    }));

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      discussion: {
        id: graphDiscussion.id,
        schemaVersionId: graphDiscussion.schemaVersionId,
        targetId: graphDiscussion.targetId,
        referenceLine: graphDiscussion.referenceLine ?? '',
        openingComment: comments[0],
        isResolved: graphDiscussion.isResolved,
      },
      comments,
    };
  });
}
