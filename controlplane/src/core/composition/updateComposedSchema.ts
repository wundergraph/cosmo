import { JsonValue } from '@bufbuild/protobuf';
import { CompositionError } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { buildRouterConfig } from '@wundergraph/cosmo-shared';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { Composer } from './composer.js';
import { getDiffBetweenGraphs } from './schemaCheck.js';

export const updateComposedSchema = async ({
  fedGraphRepo,
  subgraphRepo,
  federatedGraph,
}: {
  federatedGraph: {
    name: string;
    targetId: string;
  };
  fedGraphRepo: FederatedGraphRepository;
  subgraphRepo: SubgraphRepository;
}) => {
  const compositionErrors: CompositionError[] = [];
  const compChecker = new Composer(fedGraphRepo, subgraphRepo);

  const composedGraph = await compChecker.composeFederatedGraph(federatedGraph.name, federatedGraph.targetId);

  /**
   * Build router config when composed schema is valid
   */
  const hasErrors = composedGraph.errors.length > 0;

  let routerConfigJson: JsonValue = null;
  if (!hasErrors && composedGraph.composedSchema) {
    const routerConfig = buildRouterConfig({
      argumentConfigurations: composedGraph.argumentConfigurations,
      subgraphs: composedGraph.subgraphs,
      federatedSDL: composedGraph.composedSchema,
    });
    routerConfigJson = routerConfig.toJson();
  }

  // We always create a new version in the database, but
  // we mark versions with compositions errors as not composable
  const updatedFederatedGraph = await fedGraphRepo.updateSchema({
    graphName: composedGraph.name,
    composedSDL: composedGraph.composedSchema,
    compositionErrors: composedGraph.errors,
    routerConfig: routerConfigJson,
  });

  if (composedGraph.composedSchema && updatedFederatedGraph?.composedSchemaVersionId) {
    const schemaChanges = await getDiffBetweenGraphs('', composedGraph.composedSchema);

    if (schemaChanges.kind !== 'failure') {
      await fedGraphRepo.createFederatedGraphChangelog({
        schemaVersionID: updatedFederatedGraph.composedSchemaVersionId,
        changes: schemaChanges.changes,
      });
    }
  }

  if (composedGraph.errors && composedGraph.errors.length > 0) {
    for (const error of composedGraph.errors) {
      compositionErrors.push({
        message: error.message,
        federatedGraphName: composedGraph.name,
      } as CompositionError);
    }
  }

  return compositionErrors;
};
