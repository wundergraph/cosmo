import { Warning } from '../warnings/types';
import { DocumentNode, GraphQLSchema, OperationTypeNode } from 'graphql';
import { ConfigurationData } from '../router-configuration/types';
import {
  AuthorizationData,
  ConditionalFieldData,
  EntityData,
  EntityInterfaceSubgraphData,
  ParentDefinitionData,
  PersistedDirectiveDefinitionData,
} from '../schema-building/types';
import { Graph } from '../resolvability-graph/graph';
import { InternalSubgraph } from '../subgraph/types';

export type NormalizationResultFailure = {
  errors: Array<Error>;
  success: false;
  warnings: Array<Warning>;
};

export type NormalizationResultSuccess = {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  conditionalFieldDataByCoordinates: Map<string, ConditionalFieldData>;
  configurationDataByTypeName: Map<string, ConfigurationData>;
  entityInterfaces: Map<string, EntityInterfaceSubgraphData>;
  entityDataByTypeName: Map<string, EntityData>;
  fieldCoordsByNamedTypeName: Map<string, Set<string>>;
  originalTypeNameByRenamedTypeName: Map<string, string>;
  isEventDrivenGraph: boolean;
  isVersionTwo: boolean;
  keyFieldNamesByParentTypeName: Map<string, Set<string>>;
  keyFieldSetsByEntityTypeNameByKeyFieldCoords: Map<string, Map<string, Set<string>>>;
  operationTypes: Map<string, OperationTypeNode>;
  overridesByTargetSubgraphName: Map<string, Map<string, Set<string>>>;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  persistedDirectiveDefinitionDataByDirectiveName: Map<string, PersistedDirectiveDefinitionData>;
  schema: GraphQLSchema;
  subgraphAST: DocumentNode;
  subgraphString: string;
  success: true;
  warnings: Array<Warning>;
};

export type NormalizationResult = NormalizationResultFailure | NormalizationResultSuccess;

export type BatchNormalizationResultFailure = {
  errors: Array<Error>;
  success: false;
  warnings: Array<Warning>;
};

export type BatchNormalizationResultSuccess = {
  success: true;
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  entityDataByTypeName: Map<string, EntityData>;
  fieldCoordsByNamedTypeName: Map<string, Set<string>>;
  internalSubgraphBySubgraphName: Map<string, InternalSubgraph>;
  internalGraph: Graph;
  warnings: Array<Warning>;
};

export type BatchNormalizationResult = BatchNormalizationResultFailure | BatchNormalizationResultSuccess;
