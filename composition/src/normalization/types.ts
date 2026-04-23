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
import {
  type AbstractTypeName,
  type DirectiveName,
  type InterfaceTypeName,
  type SubgraphName,
  type TypeName,
} from '../types/types';

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
  interfaceImplementationTypeNamesByInterfaceTypeName: Map<InterfaceTypeName, Set<InterfaceTypeName>>;
  isEventDrivenGraph: boolean;
  isVersionTwo: boolean;
  originalTypeNameByRenamedTypeName: Map<string, string>;
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
  authorizationDataByParentTypeName: Map<TypeName, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<AbstractTypeName, Set<TypeName>>;
  entityDataByTypeName: Map<TypeName, EntityData>;
  fieldCoordsByNamedTypeName: Map<TypeName, Set<string>>;
  interfaceImplementationTypeNamesByInterfaceTypeName: Map<InterfaceTypeName, Set<InterfaceTypeName>>;
  internalSubgraphBySubgraphName: Map<SubgraphName, InternalSubgraph>;
  internalGraph: Graph;
  warnings: Array<Warning>;
};

export type BatchNormalizationResult = BatchNormalizationFailure | BatchNormalizationSuccess;
