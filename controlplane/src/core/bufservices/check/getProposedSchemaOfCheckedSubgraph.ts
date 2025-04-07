import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetProposedSchemaOfCheckedSubgraphRequest,
  GetProposedSchemaOfCheckedSubgraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { SchemaCheckRepository } from '../../repositories/SchemaCheckRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getProposedSchemaOfCheckedSubgraph(
  opts: RouterOptions,
  req: GetProposedSchemaOfCheckedSubgraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetProposedSchemaOfCheckedSubgraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetProposedSchemaOfCheckedSubgraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const schemaCheckRepo = new SchemaCheckRepository(opts.db);
    const proposedSchema = await schemaCheckRepo.getProposedSchemaOfCheckedSubgraph({
      checkId: req.checkId,
      checkedSubgraphId: req.checkedSubgraphId,
    });

    if (!proposedSchema || !proposedSchema.proposedSubgraphSchemaSDL) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Proposed schema not found',
        },
        proposedSchema: '',
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      proposedSchema: proposedSchema.proposedSubgraphSchemaSDL,
    };
  });
}
