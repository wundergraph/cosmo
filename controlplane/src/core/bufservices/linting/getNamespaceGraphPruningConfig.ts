import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetNamespaceGraphPruningConfigRequest,
  GetNamespaceGraphPruningConfigResponse,
  GraphPruningConfig,
  LintSeverity,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SchemaGraphPruningRepository } from '../../repositories/SchemaGraphPruningRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getNamespaceGraphPruningConfig(
  opts: RouterOptions,
  req: GetNamespaceGraphPruningConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetNamespaceGraphPruningConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetNamespaceGraphPruningConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const schemaGraphPruningRepo = new SchemaGraphPruningRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
        configs: [],
        graphPrunerEnabled: false,
      };
    }

    if (!authContext.rbac.hasNamespaceReadAccess(namespace)) {
      throw new UnauthorizedError();
    }

    const graphPruningConfigs = await schemaGraphPruningRepo.getNamespaceGraphPruningConfig(namespace.id);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      configs: graphPruningConfigs.map((l) => {
        return new GraphPruningConfig({
          ruleName: l.ruleName,
          severityLevel: l.severity === 'error' ? LintSeverity.error : LintSeverity.warn,
          gracePeriodInDays: l.gracePeriodInDays,
          schemaUsageCheckPeriodInDays: l.schemaUsageCheckPeriodInDays,
        });
      }),
      graphPrunerEnabled: namespace.enableGraphPruning,
    };
  });
}
