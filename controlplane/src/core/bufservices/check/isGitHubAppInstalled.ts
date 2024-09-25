import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  IsGitHubAppInstalledRequest,
  IsGitHubAppInstalledResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { GitHubRepository } from '../../repositories/GitHubRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function isGitHubAppInstalled(
  opts: RouterOptions,
  req: IsGitHubAppInstalledRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<IsGitHubAppInstalledResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<IsGitHubAppInstalledResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepository = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    if (!opts.githubApp) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'GitHub app integration is disabled',
        },
        isInstalled: false,
      };
    }

    const org = orgRepository.byId(authContext.organizationId);
    if (!org) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Organization not found',
        },
        isInstalled: false,
      };
    }

    if (!req.gitInfo) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        isInstalled: false,
      };
    }

    const githubRepository = new GitHubRepository(opts.db, opts.githubApp);
    const isInstalled = await githubRepository.isAppInstalledOnRepo({
      accountId: req.gitInfo.accountId,
      repoSlug: req.gitInfo.repositorySlug,
      ownerSlug: req.gitInfo.ownerSlug,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      isInstalled,
    };
  });
}
