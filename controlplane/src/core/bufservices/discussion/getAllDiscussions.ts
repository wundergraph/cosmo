import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetAllDiscussionsRequest,
  GetAllDiscussionsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DiscussionRepository } from '../../repositories/DiscussionRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getAllDiscussions(
  opts: RouterOptions,
  req: GetAllDiscussionsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetAllDiscussionsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetAllDiscussionsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);

    const canReply = await discussionRepo.canAccessTarget(req.targetId);
    if (!canReply) {
      return {
        response: {
          code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
          details: 'You are not authorized to the discussions of this graph',
        },
        discussions: [],
      };
    }

    const graphDiscussions = await discussionRepo.getAllDiscussions({
      ...req,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      discussions: graphDiscussions.map((gd) => ({
        id: gd.id,
        schemaVersionId: gd.schemaVersionId,
        targetId: gd.targetId,
        referenceLine: gd.referenceLine ?? '',
        isResolved: gd.isResolved,
        openingComment: {
          id: gd.thread[0].id,
          contentJson: JSON.stringify(gd.thread[0].contentJson),
          createdAt: gd.thread[0].createdAt.toISOString(),
          updatedAt: gd.thread[0].updatedAt?.toISOString(),
          createdBy: gd.thread[0].createdById ?? undefined,
          isDeleted: gd.thread[0].isDeleted,
        },
      })),
    };
  });
}
