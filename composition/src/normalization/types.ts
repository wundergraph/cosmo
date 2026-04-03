import { type Warning } from '../warnings/types';
import {
  type DirectiveDefinitionNode,
  type DocumentNode,
  type GraphQLSchema,
  type OperationTypeNode,
  type SchemaDefinitionNode,
  type SchemaExtensionNode,
} from 'graphql';
import { type ConfigurationData, type Costs } from '../router-configuration/types';
import {
  type AuthorizationData,
  type ConditionalFieldData,
  type EntityData,
  type EntityInterfaceSubgraphData,
  type ParentDefinitionData,
  type PersistedDirectiveDefinitionData,
} from '../schema-building/types';
import { type Graph } from '../resolvability-graph/graph';
import { type InternalSubgraph } from '../subgraph/types';
import { type DirectiveName, type TypeName } from '../types/types';

export type NormalizationFailure = {
  errors: Array<Error>;
  success: false;
  warnings: Array<Warning>;
};

export type NormalizationSuccess = {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  conditionalFieldDataByCoordinates: Map<string, ConditionalFieldData>;
  configurationDataByTypeName: Map<TypeName, ConfigurationData>;
  costs: Costs;
  directiveDefinitionByName: Map<DirectiveName, DirectiveDefinitionNode>;
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
  schemaNode?: SchemaDefinitionNode | SchemaExtensionNode;
};

export type NormalizationResult = NormalizationFailure | NormalizationSuccess;

export type BatchNormalizationFailure = {
  errors: Array<Error>;
  success: false;
  warnings: Array<Warning>;
};

export type BatchNormalizationSuccess = {
  success: true;
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  entityDataByTypeName: Map<string, EntityData>;
  fieldCoordsByNamedTypeName: Map<string, Set<string>>;
  internalSubgraphBySubgraphName: Map<string, InternalSubgraph>;
  internalGraph: Graph;
  warnings: Array<Warning>;
};

export type BatchNormalizationResult = BatchNormalizationFailure | BatchNormalizationSuccess;
