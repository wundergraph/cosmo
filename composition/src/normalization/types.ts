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
} from '../schema-building/types/types';
import { type Graph } from '../resolvability-graph/graph';
import { type InternalSubgraph } from '../subgraph/types';
import {
  type AbstractTypeName,
  type DirectiveName,
  type FieldName,
  type InterfaceTypeName,
  type SubgraphName,
  type TypeName,
} from '../types/types';
import { type ExecutionMultiFailure } from '../types/results';
import { type LinkImportData } from '../v1/normalization/types/types';
import { type DirectiveDefinitionData } from '../directive-definition-data/types/types';

export interface NormalizationFailure extends ExecutionMultiFailure {
  warnings: Array<Warning>;
}

export type NormalizationSuccess = {
  authorizationDataByParentTypeName: Map<TypeName, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<AbstractTypeName, Set<TypeName>>;
  conditionalFieldDataByCoordinates: Map<string, ConditionalFieldData>;
  configurationDataByTypeName: Map<TypeName, ConfigurationData>;
  costs: Costs;
  directiveDefinitionByName: Map<DirectiveName, DirectiveDefinitionNode>;
  entityInterfaces: Map<string, EntityInterfaceSubgraphData>;
  entityDataByTypeName: Map<TypeName, EntityData>;
  federatedDirectiveDataByName: Map<DirectiveName, DirectiveDefinitionData>;
  fieldCoordsByNamedTypeName: Map<TypeName, Set<string>>;
  importDataByDirectiveName: Map<DirectiveName, LinkImportData>;
  interfaceImplementationTypeNamesByInterfaceTypeName: Map<InterfaceTypeName, Set<InterfaceTypeName>>;
  isEventDrivenGraph: boolean;
  isVersionTwo: boolean;
  keyFieldNamesByParentTypeName: Map<string, Set<string>>;
  keyFieldSetsByEntityTypeNameByKeyFieldCoords: Map<string, Map<string, Set<string>>>;
  operationTypes: Map<string, OperationTypeNode>;
  originalTypeNameByRenamedTypeName: Map<TypeName, TypeName>;
  overriddenFieldNamesByParentTypeNameByTargetSubgraphName: Map<SubgraphName, Map<TypeName, Set<FieldName>>>;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
  schema: GraphQLSchema;
  subgraphAST: DocumentNode;
  subgraphString: string;
  success: true;
  warnings: Array<Warning>;
  schemaNode?: SchemaDefinitionNode | SchemaExtensionNode;
};

export type NormalizationResult = NormalizationFailure | NormalizationSuccess;

export interface BatchNormalizationFailure extends ExecutionMultiFailure {
  errors: Array<Error>;
  warnings: Array<Warning>;
}

export type BatchNormalizationSuccess = {
  success: true;
  authorizationDataByParentTypeName: Map<TypeName, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<AbstractTypeName, Set<TypeName>>;
  entityDataByTypeName: Map<TypeName, EntityData>;
  executableDirectiveDatasByName: Map<DirectiveName, Array<DirectiveDefinitionData>>;
  federatedDirectiveDataByName: Map<DirectiveName, DirectiveDefinitionData>;
  fieldCoordsByNamedTypeName: Map<TypeName, Set<string>>;
  interfaceImplementationTypeNamesByInterfaceTypeName: Map<InterfaceTypeName, Set<InterfaceTypeName>>;
  internalGraph: Graph;
  internalSubgraphByName: Map<SubgraphName, InternalSubgraph>;
  warnings: Array<Warning>;
};

export type BatchNormalizationResult = BatchNormalizationFailure | BatchNormalizationSuccess;
