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
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';

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
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    const subgraph = await subgraphRepo.byId(req.subgraphId);
    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Subgraph not found`,
        },
        proposedSchema: '',
      };
    }

    const proposedSchema = await schemaCheckRepo.getProposedSchemaOfCheckedSubgraph({
      checkId: req.checkId,
      checkedSubgraphId: req.checkedSubgraphId,
      subgraphId: req.subgraphId,
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
