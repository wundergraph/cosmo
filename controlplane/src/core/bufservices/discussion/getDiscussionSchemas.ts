import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetDiscussionSchemasRequest,
  GetDiscussionSchemasResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DiscussionRepository } from '../../repositories/DiscussionRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getDiscussionSchemas(
  opts: RouterOptions,
  req: GetDiscussionSchemasRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetDiscussionSchemasResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetDiscussionSchemasResponse>>(ctx, logger, async () => {
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

    const { referenceResult, latestResult } = await discussionRepo.getSchemas({
      targetId: graphDiscussion.targetId,
      schemaVersionId: graphDiscussion.schemaVersionId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      schemas: {
        reference: referenceResult?.schemaSDL ?? '',
        latest: latestResult?.schemaSDL ?? '',
      },
    };
  });
}
