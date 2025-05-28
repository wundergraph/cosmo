import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetNamespaceLintConfigRequest,
  GetNamespaceLintConfigResponse,
  LintConfig,
  LintSeverity,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SchemaLintRepository } from '../../repositories/SchemaLintRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getNamespaceLintConfig(
  opts: RouterOptions,
  req: GetNamespaceLintConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetNamespaceLintConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetNamespaceLintConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const schemaLintRepo = new SchemaLintRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
        configs: [],
        linterEnabled: false,
      };
    }

    if (!authContext.rbac.hasNamespaceReadAccess(namespace)) {
      throw new UnauthorizedError();
    }

    const orgLintConfigs = await schemaLintRepo.getNamespaceLintConfig(namespace.id);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      configs: orgLintConfigs.map((l) => {
        return {
          ruleName: l.ruleName,
          severityLevel: l.severity === 'error' ? LintSeverity.error : LintSeverity.warn,
        } as LintConfig;
      }),
      linterEnabled: namespace.enableLinting,
    };
  });
}
