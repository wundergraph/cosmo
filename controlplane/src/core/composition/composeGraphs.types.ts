/**
 * These types define the thread boundary for compose-and-deploy work.
 *
 * The `Serialized*` prefix is intentional: these payloads are flattened to
 * structured-clone-safe data before crossing the Tinypool worker boundary.
 * Rich runtime objects such as GraphQL schema instances, Maps, protobuf
 * classes, and custom Error/Warning instances are reconstructed outside the
 * worker when needed.
 */
import type {
  CompositionOptions,
  FieldConfiguration,
  SupportedRouterCompatibilityVersion,
} from '@wundergraph/composition';
import { RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { FederatedGraphDTO, SubgraphDTO } from '../../types/index.js';

export interface SerializedContractTagOptions {
  contractName: string;
  excludeTags: string[];
  includeTags: string[];
}

export interface SerializedCompositionWarning {
  message: string;
  subgraphName?: string;
}

export interface SerializedComposedSubgraph {
  id: string;
  isFeatureSubgraph: boolean;
  name: string;
  sdl: string;
  schemaVersionId: string;
  targetId: string;
}

export interface SerializedComposedGraphArtifact {
  success: boolean;
  errors: string[];
  warnings: SerializedCompositionWarning[];
  composedSchema?: string;
  federatedClientSchema?: string;
  shouldIncludeClientSchema: boolean;
  fieldConfigurations: FieldConfiguration[];
  subgraphs: SerializedComposedSubgraph[];
  routerExecutionConfigJson?: ReturnType<RouterConfig['toJson']>;
}

export interface SerializedContractCompositionArtifact {
  contractName: string;
  artifact: SerializedComposedGraphArtifact;
}

export interface ComposeGraphsTaskInput {
  federatedGraph: FederatedGraphDTO;
  /** Pre-validated on the main thread before dispatching to the worker. */
  routerCompatibilityVersion: SupportedRouterCompatibilityVersion;
  subgraphsToCompose: {
    subgraphs: SubgraphDTO[];
    isFeatureFlagComposition: boolean;
    featureFlagName: string;
    featureFlagId: string;
  }[];
  tagOptionsByContractName: SerializedContractTagOptions[];
  compositionOptions?: CompositionOptions;
  skipRouterConfig?: boolean;
}

export interface ComposeGraphsTaskResultItem {
  isFeatureFlagComposition: boolean;
  featureFlagName: string;
  featureFlagId: string;
  base: SerializedComposedGraphArtifact;
  contracts: SerializedContractCompositionArtifact[];
}

export interface ComposeGraphsTaskResult {
  results: ComposeGraphsTaskResultItem[];
}
