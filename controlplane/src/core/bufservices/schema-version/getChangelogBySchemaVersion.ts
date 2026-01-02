import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetChangelogBySchemaVersionRequest,
  GetChangelogBySchemaVersionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GraphCompositionRepository } from '../../repositories/GraphCompositionRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getChangelogBySchemaVersion(
  opts: RouterOptions,
  req: GetChangelogBySchemaVersionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetChangelogBySchemaVersionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetChangelogBySchemaVersionResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const graphCompositionRepo = new GraphCompositionRepository(logger, opts.db);

    const composition = await graphCompositionRepo.getGraphCompositionBySchemaVersion({
      schemaVersionId: req.schemaVersionId,
      organizationId: authContext.organizationId,
    });

    if (!composition) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Could not find composition linked to the changelog',
        },
      };
    }

    const changelogs = await fedRepo.fetchChangelogByVersion({
      schemaVersionId: req.schemaVersionId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      changelog: {
        changelogs,
        schemaVersionId: req.schemaVersionId,
        createdAt: changelogs.length === 0 ? '' : changelogs[0].createdAt,
        compositionId: composition?.id,
      },
    };
  });
}
