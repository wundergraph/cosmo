import { Warning } from '../warnings/types';
import {
  DirectiveDefinitionNode,
  DocumentNode,
  GraphQLSchema,
  OperationTypeNode,
  SchemaDefinitionNode,
  SchemaExtensionNode,
} from 'graphql';
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
import { DirectiveName, TypeName } from '../types/types';

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
