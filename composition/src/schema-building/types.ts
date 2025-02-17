import {
  ConstDirectiveNode,
  ConstValueNode,
  DirectiveDefinitionNode,
  Kind,
  NamedTypeNode,
  OperationTypeDefinitionNode,
  OperationTypeNode,
  StringValueNode,
  TypeNode,
} from 'graphql';
import {
  MutableEnumNode,
  MutableEnumValueNode,
  MutableFieldNode,
  MutableInputObjectNode,
  MutableInputValueNode,
  MutableInterfaceNode,
  MutableObjectNode,
  MutableScalarNode,
  MutableTypeNode,
  MutableUnionNode,
} from './ast';
import { FieldSetCondition } from '../router-configuration/router-configuration';

export type ArgumentData = {
  name: string;
  typeNode: TypeNode;
  defaultValue?: ConstValueNode;
};

export type ConfigureDescriptionData = {
  propagate: boolean;
  description: string;
};

export type DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: Map<string, ArgumentData>;
  isRepeatable: boolean;
  locations: Set<string>;
  name: string;
  node: DirectiveDefinitionNode;
  // required arguments with a default value are considered optional
  optionalArgumentNames: Set<string>;
  requiredArgumentNames: Set<string>;
};

export enum ExtensionType {
  EXTENDS,
  NONE,
  REAL,
}

export type EnumDefinitionData = {
  appearances: number;
  configureDescriptionDataBySubgraphName: Map<string, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  enumValueDataByValueName: Map<string, EnumValueData>;
  extensionType: ExtensionType;
  kind: Kind.ENUM_TYPE_DEFINITION;
  name: string;
  node: MutableEnumNode;
  persistedDirectivesData: PersistedDirectivesData;
  subgraphNames: Set<string>;
  description?: StringValueNode;
};

export type EnumValueData = {
  appearances: number;
  configureDescriptionDataBySubgraphName: Map<string, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  kind: Kind.ENUM_VALUE_DEFINITION;
  name: string;
  node: MutableEnumValueNode;
  parentTypeName: string;
  persistedDirectivesData: PersistedDirectivesData;
  subgraphNames: Set<string>;
  description?: StringValueNode;
};

export type FieldData = {
  argumentDataByArgumentName: Map<string, InputValueData>;
  configureDescriptionDataBySubgraphName: Map<string, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  isExternalBySubgraphName: Map<string, boolean>;
  isInaccessible: boolean;
  isShareableBySubgraphName: Map<string, boolean>;
  kind: Kind.FIELD_DEFINITION;
  name: string;
  namedTypeName: string;
  node: MutableFieldNode;
  originalParentTypeName: string;
  persistedDirectivesData: PersistedDirectivesData;
  renamedParentTypeName: string;
  subgraphNames: Set<string>;
  type: MutableTypeNode;
  description?: StringValueNode;
};

export type InputObjectDefinitionData = {
  configureDescriptionDataBySubgraphName: Map<string, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  extensionType: ExtensionType;
  inputValueDataByValueName: Map<string, InputValueData>;
  isInaccessible: boolean;
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION;
  name: string;
  node: MutableInputObjectNode;
  persistedDirectivesData: PersistedDirectivesData;
  subgraphNames: Set<string>;
  description?: StringValueNode;
};

export type InputValueData = {
  configureDescriptionDataBySubgraphName: Map<string, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  includeDefaultValue: boolean;
  isArgument: boolean;
  kind: Kind.ARGUMENT | Kind.INPUT_VALUE_DEFINITION;
  name: string;
  node: MutableInputValueNode;
  originalPath: string;
  renamedPath: string;
  persistedDirectivesData: PersistedDirectivesData;
  requiredSubgraphNames: Set<string>;
  subgraphNames: Set<string>;
  type: MutableTypeNode;
  defaultValue?: ConstValueNode;
  description?: StringValueNode;
};

export type InterfaceDefinitionData = {
  configureDescriptionDataBySubgraphName: Map<string, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  extensionType: ExtensionType;
  fieldDataByFieldName: Map<string, FieldData>;
  implementedInterfaceTypeNames: Set<string>;
  isEntity: boolean;
  isInaccessible: boolean;
  kind: Kind.INTERFACE_TYPE_DEFINITION;
  name: string;
  node: MutableInterfaceNode;
  persistedDirectivesData: PersistedDirectivesData;
  subgraphNames: Set<string>;
  description?: StringValueNode;
};

export type ObjectDefinitionData = {
  configureDescriptionDataBySubgraphName: Map<string, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  extensionType: ExtensionType;
  fieldDataByFieldName: Map<string, FieldData>;
  implementedInterfaceTypeNames: Set<string>;
  isEntity: boolean;
  isInaccessible: boolean;
  isRootType: boolean;
  kind: Kind.OBJECT_TYPE_DEFINITION;
  name: string;
  node: MutableObjectNode;
  persistedDirectivesData: PersistedDirectivesData;
  renamedTypeName: string;
  subgraphNames: Set<string>;
  description?: StringValueNode;
};

export type PersistedDirectiveDefinitionData = {
  argumentDataByArgumentName: Map<string, InputValueData>;
  executableLocations: Set<string>;
  name: string;
  repeatable: boolean;
  subgraphNames: Set<string>;
  description?: StringValueNode;
};

export type PersistedDirectivesData = {
  deprecatedReason: string;
  directives: Map<string, ConstDirectiveNode[]>;
  isDeprecated: boolean;
  tags: Map<string, ConstDirectiveNode>;
};

export type ScalarDefinitionData = {
  configureDescriptionDataBySubgraphName: Map<string, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  extensionType: ExtensionType;
  kind: Kind.SCALAR_TYPE_DEFINITION;
  name: string;
  node: MutableScalarNode;
  persistedDirectivesData: PersistedDirectivesData;
  description?: StringValueNode;
};

export type SchemaData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  kind: Kind.SCHEMA_DEFINITION;
  name: string;
  operationTypes: Map<OperationTypeNode, OperationTypeDefinitionNode>;
  description?: StringValueNode;
};

export type UnionDefinitionData = {
  configureDescriptionDataBySubgraphName: Map<string, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  extensionType: ExtensionType;
  kind: Kind.UNION_TYPE_DEFINITION;
  name: string;
  memberByMemberTypeName: Map<string, NamedTypeNode>;
  node: MutableUnionNode;
  persistedDirectivesData: PersistedDirectivesData;
  description?: StringValueNode;
};

export type ParentDefinitionData =
  | EnumDefinitionData
  | InputObjectDefinitionData
  | InterfaceDefinitionData
  | ObjectDefinitionData
  | ScalarDefinitionData
  | UnionDefinitionData;

export type ChildData = EnumValueData | FieldData | InputValueData;

export type CompositeOutputData = InterfaceDefinitionData | ObjectDefinitionData;

export type DefinitionData =
  | EnumDefinitionData
  | EnumValueData
  | FieldData
  | InputObjectDefinitionData
  | InputValueData
  | InterfaceDefinitionData
  | ObjectDefinitionData
  | PersistedDirectiveDefinitionData
  | ScalarDefinitionData
  | UnionDefinitionData;

export type NodeData = ParentDefinitionData | ChildData;

export type EntityData = {
  fieldNames: Set<string>;
  keyFieldSets: Set<string>;
  subgraphNames: Set<string>;
  typeName: string;
};

export type SimpleFieldData = {
  name: string;
  namedTypeName: string;
};

export type EntityInterfaceSubgraphData = {
  fieldDatas: Array<SimpleFieldData>;
  interfaceFieldNames: Set<string>;
  interfaceObjectFieldNames: Set<string>;
  isInterfaceObject: boolean;
  typeName: string;
  concreteTypeNames?: Set<string>;
};
export type FieldAuthorizationData = {
  fieldName: string;
  requiresAuthentication: boolean;
  requiredScopes: Set<string>[];
};
export type AuthorizationData = {
  fieldAuthorizationDataByFieldName: Map<string, FieldAuthorizationData>;
  hasParentLevelAuthorization: boolean;
  requiresAuthentication: boolean;
  requiredScopes: Set<string>[];
  typeName: string;
};
export type ConditionalFieldData = {
  providedBy: Array<FieldSetCondition>;
  requiredBy: Array<FieldSetCondition>;
};
