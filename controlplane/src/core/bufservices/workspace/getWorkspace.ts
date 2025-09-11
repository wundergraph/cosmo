import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetWorkspaceRequest,
  GetWorkspaceResponse,
  WorkspaceNamespace,
  WorkspaceFederatedGraph,
  type WorkspaceSubgraph,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';

export function getWorkspace(
  opts: RouterOptions,
  req: GetWorkspaceRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetWorkspaceResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetWorkspaceResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    // Step 1 - Retrieve all the namespaces the requesting actor have access to
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const namespaces = await namespaceRepo.list(authContext.rbac);
    if (namespaces.length === 0) {
      // The user doesn't have access to any namespace
      return {
        response: { code: EnumStatusCode.OK },
        namespaces: [],
      };
    }

    // Initialize the response
    const result = namespaces
      .map((ns) =>
        WorkspaceNamespace.fromJson({
          id: ns.id,
          name: ns.name,
          graphs: [],
        } satisfies PlainMessage<WorkspaceNamespace>),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

    // Step 2 - Retrieve all the federated graphs the actor has access to, based on the namespaces
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraphs = await fedGraphRepo.list({
      offset: 0, // From the beginning
      limit: 0, // Retrieve all federated graphs
      namespaceIds: namespaces.map((ns) => ns.id),
      rbac: authContext.rbac,
    });

    if (federatedGraphs.length === 0) {
      //
      return {
        response: { code: EnumStatusCode.OK },
        namespaces: result,
      };
    }

    //
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    await Promise.all(
      federatedGraphs.map(async (graph) => {
        const namespace = result.find((ns) => ns.id === graph.namespaceId);
        if (!namespace) {
          //
          return;
        }

        const subgraphsForFederatedGraph = await subgraphRepo.listByFederatedGraph({
          federatedGraphTargetId: graph.targetId,
          rbac: authContext.rbac,
        });

        //
        namespace.graphs.push(
          WorkspaceFederatedGraph.fromJson({
            id: graph.id,
            targetId: graph.targetId,
            name: graph.name,
            isContract: !!graph.contract?.id,
            subgraphs: subgraphsForFederatedGraph
              .map(
                (subgraph) =>
                  ({
                    id: subgraph.id,
                    targetId: subgraph.targetId,
                    name: subgraph.name,
                  }) satisfies PlainMessage<WorkspaceSubgraph>,
              )
              .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
          } satisfies PlainMessage<WorkspaceFederatedGraph>),
        );
      }),
    );

    // Finally, sort the namespaces alphabetically
    for (const namespace of result) {
      namespace.graphs.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    }

    return {
      response: { code: EnumStatusCode.OK },
      namespaces: result,
    };
  });
}
