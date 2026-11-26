import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  RenameNamespaceRequest,
  RenameNamespaceResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidNamespaceName } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import type { PlainMessage } from '../../../types/index.js';
import { sendGraphLifecycle } from '../../webhooks/graphLifecycleWebhook.js';

export function renameNamespace(
  opts: RouterOptions,
  req: RenameNamespaceRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RenameNamespaceResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RenameNamespaceResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const isNewNameValid = isValidNamespaceName(req.newName);
    if (!isNewNameValid) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details:
            'The provided new name is invalid. The name can contain letters and numbers separated by underscore or hyphens',
        },
      };
    }

    if (req.name === DefaultNamespace) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'You cannot rename the default namespace',
        },
      };
    }

    const exists = await namespaceRepo.byName(req.name);
    if (!exists) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'The namespace was not found',
        },
      };
    }

    if (!authContext.rbac.hasNamespaceWriteAccess(exists)) {
      throw new UnauthorizedError();
    }

    const nameTaken = await namespaceRepo.byName(req.newName);
    if (nameTaken) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'The new namespace name is already taken',
        },
      };
    }

    await namespaceRepo.rename({
      ...req,
    });

    // Every graph in the namespace now lives under its new name.
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const graphs = await fedGraphRepo.list({ namespaceIds: [exists.id], offset: 0, limit: 0 });
    for (const graph of graphs) {
      sendGraphLifecycle(opts, {
        eventName: OrganizationEventName.GRAPH_MOVED,
        authContext,
        graph: {
          id: graph.id,
          name: graph.name,
          namespace: req.newName,
          type: graph.supportsFederation ? 'federated' : 'monograph',
        },
      });
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
