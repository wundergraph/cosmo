/**
 * This file is intended to be used with a worker thread.
 * In watch mode changes aren't immediately applied. You have to rebuild the project with tsc before changes are applied.
 */
import { isMainThread } from 'node:worker_threads';
import { join } from 'node:path';
import {
  ContractTagOptions,
  FederationResult,
  FederationResultWithContracts,
  newContractTagOptionsFromArrays,
} from '@wundergraph/composition';
import { Tinypool } from 'tinypool';
import {
  composeFederatedContract,
  composeFederatedGraphWithPotentialContracts,
} from '../core/composition/composition.js';
import { CompositionOptions, FederatedGraphDTO } from '../types/index.js';
import { SubgraphsToCompose } from '../core/repositories/FeatureFlagRepository.js';

interface Inputs {
  federatedGraph: FederatedGraphDTO;
  subgraphsToCompose: SubgraphsToCompose;
  tagOptionsByContractName: Map<string, ContractTagOptions>;
  compositionOptions?: CompositionOptions;
}

export function getWorkerPool(maxCount?: number): Tinypool | undefined {
  if (isMainThread) {
    const filename = import.meta.url.endsWith('.ts') ? join(process.cwd(), 'dist/workers/compose.js') : import.meta.url;
    return new Tinypool({ filename, name: 'composeFederatedGraph', maxThreads: maxCount });
  } else {
    return undefined;
  }
}

export function composeFederatedGraph({
  federatedGraph,
  subgraphsToCompose,
  tagOptionsByContractName,
  compositionOptions,
}: Inputs): FederationResult | FederationResultWithContracts {
  // This condition is only true when entering the method to specifically create/update a contract
  if (federatedGraph.contract) {
    return composeFederatedContract(
      subgraphsToCompose.compositionSubgraphs,
      newContractTagOptionsFromArrays(federatedGraph.contract.excludeTags, federatedGraph.contract.includeTags),
      federatedGraph.routerCompatibilityVersion,
      compositionOptions,
    );
  }
  return composeFederatedGraphWithPotentialContracts(
    subgraphsToCompose.compositionSubgraphs,
    tagOptionsByContractName,
    federatedGraph.routerCompatibilityVersion,
    compositionOptions,
  );
}
