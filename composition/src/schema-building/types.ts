import {
  ConstDirectiveNode,
  ConstValueNode,
  DirectiveDefinitionNode,
  DocumentNode,
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
import { FieldSetConditionData } from '../router-configuration/types';
import { KeyFieldSetData } from '../v1/normalization/types';
import { InputNodeKind, OutputNodeKind } from '../utils/types';
import { DirectiveName, FieldName, SubgraphName, TypeName } from '../types/types';

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
  argumentTypeNodeByName: Map<string, ArgumentData>;
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
  configureDescriptionDataBySubgraphName: Map<SubgraphName, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  enumValueDataByName: Map<string, EnumValueData>;
  extensionType: ExtensionType;
  isInaccessible: boolean;
  kind: Kind.ENUM_TYPE_DEFINITION;
  name: string;
  node: MutableEnumNode;
  persistedDirectivesData: PersistedDirectivesData;
  subgraphNames: Set<SubgraphName>;
  description?: StringValueNode;
};

export type EnumValueData = {
  appearances: number;
  configureDescriptionDataBySubgraphName: Map<SubgraphName, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  federatedCoords: string;
  kind: Kind.ENUM_VALUE_DEFINITION;
  name: string;
  node: MutableEnumValueNode;
  parentTypeName: TypeName;
  persistedDirectivesData: PersistedDirectivesData;
  subgraphNames: Set<SubgraphName>;
  description?: StringValueNode;
};

export type ExternalFieldData = {
  // Indiscriminate representation of whether  @external is defined on the field.
  isDefinedExternal: boolean;
  /*
   * A field with an @external directive definition may still be unconditionally provided.
   * For example, entity extension key fields are determined to be unconditionally resolvable.
   * */
  isUnconditionallyProvided: boolean;
};

export type FieldData = {
  argumentDataByName: Map<string, InputValueData>;
  configureDescriptionDataBySubgraphName: Map<SubgraphName, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  externalFieldDataBySubgraphName: Map<SubgraphName, ExternalFieldData>;
  federatedCoords: string;
  inheritedDirectiveNames: Set<DirectiveName>;
  isInaccessible: boolean;
  isShareableBySubgraphName: Map<SubgraphName, boolean>;
  kind: Kind.FIELD_DEFINITION;
  name: FieldName;
  namedTypeKind: OutputNodeKind | Kind.NULL;
  namedTypeName: TypeName;
  node: MutableFieldNode;
  nullLevelsBySubgraphName: Map<SubgraphName, Set<number>>;
  originalParentTypeName: TypeName;
  persistedDirectivesData: PersistedDirectivesData;
  renamedParentTypeName: TypeName;
  subgraphNames: Set<SubgraphName>;
  type: MutableTypeNode;
  description?: StringValueNode;
};

export type InputObjectDefinitionData = {
  configureDescriptionDataBySubgraphName: Map<SubgraphName, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  extensionType: ExtensionType;
  inputValueDataByName: Map<FieldName, InputValueData>;
  isInaccessible: boolean;
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION;
  name: TypeName;
  node: MutableInputObjectNode;
  persistedDirectivesData: PersistedDirectivesData;
  subgraphNames: Set<SubgraphName>;
  description?: StringValueNode;
};

export type InputValueData = {
  configureDescriptionDataBySubgraphName: Map<SubgraphName, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  federatedCoords: string;
  includeDefaultValue: boolean;
  isArgument: boolean;
  kind: Kind.ARGUMENT | Kind.INPUT_VALUE_DEFINITION;
  name: FieldName;
  namedTypeKind: InputNodeKind | Kind.NULL;
  namedTypeName: TypeName;
  node: MutableInputValueNode;
  originalCoords: string;
  originalParentTypeName: TypeName;
  persistedDirectivesData: PersistedDirectivesData;
  renamedParentTypeName: TypeName;
  requiredSubgraphNames: Set<SubgraphName>;
  subgraphNames: Set<SubgraphName>;
  type: MutableTypeNode;
  defaultValue?: ConstValueNode;
  description?: StringValueNode;
  fieldName?: FieldName;
};

export type InterfaceDefinitionData = {
  configureDescriptionDataBySubgraphName: Map<SubgraphName, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  extensionType: ExtensionType;
  fieldDataByName: Map<FieldName, FieldData>;
  implementedInterfaceTypeNames: Set<TypeName>;
  isEntity: boolean;
  isInaccessible: boolean;
  kind: Kind.INTERFACE_TYPE_DEFINITION;
  name: TypeName;
  node: MutableInterfaceNode;
  persistedDirectivesData: PersistedDirectivesData;
  requireFetchReasonsFieldNames: Set<FieldName>;
  subgraphNames: Set<SubgraphName>;
  description?: StringValueNode;
};

export type ObjectDefinitionData = {
  configureDescriptionDataBySubgraphName: Map<SubgraphName, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  extensionType: ExtensionType;
  fieldDataByName: Map<FieldName, FieldData>;
  implementedInterfaceTypeNames: Set<TypeName>;
  isEntity: boolean;
  isInaccessible: boolean;
  isRootType: boolean;
  kind: Kind.OBJECT_TYPE_DEFINITION;
  name: TypeName;
  node: MutableObjectNode;
  persistedDirectivesData: PersistedDirectivesData;
  renamedTypeName: TypeName;
  requireFetchReasonsFieldNames: Set<FieldName>;
  subgraphNames: Set<SubgraphName>;
  description?: StringValueNode;
};

export type PersistedDirectiveDefinitionData = {
  argumentDataByName: Map<string, InputValueData>;
  executableLocations: Set<string>;
  name: DirectiveName;
  repeatable: boolean;
  subgraphNames: Set<SubgraphName>;
  description?: StringValueNode;
};

export type PersistedDirectivesData = {
  deprecatedReason: string;
  directivesByDirectiveName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  isDeprecated: boolean;
  tagDirectiveByName: Map<string, ConstDirectiveNode>;
};

export type ScalarDefinitionData = {
  configureDescriptionDataBySubgraphName: Map<SubgraphName, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  extensionType: ExtensionType;
  kind: Kind.SCALAR_TYPE_DEFINITION;
  name: TypeName;
  node: MutableScalarNode;
  persistedDirectivesData: PersistedDirectivesData;
  subgraphNames: Set<SubgraphName>;
  description?: StringValueNode;
};

export type SchemaData = {
  directivesByDirectiveName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  kind: Kind.SCHEMA_DEFINITION;
  name: string;
  operationTypes: Map<OperationTypeNode, OperationTypeDefinitionNode>;
  description?: StringValueNode;
};

export type UnionDefinitionData = {
  configureDescriptionDataBySubgraphName: Map<SubgraphName, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  extensionType: ExtensionType;
  kind: Kind.UNION_TYPE_DEFINITION;
  name: TypeName;
  memberByMemberTypeName: Map<TypeName, NamedTypeNode>;
  node: MutableUnionNode;
  persistedDirectivesData: PersistedDirectivesData;
  subgraphNames: Set<SubgraphName>;
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
  // If propagated in documentNodeByKeyFieldSet, at least one subgraph defines a resolvable key with this field set.
  documentNodeByKeyFieldSet: Map<string, DocumentNode>;
  keyFieldSets: Set<string>;
  keyFieldSetDatasBySubgraphName: Map<SubgraphName, Map<string, KeyFieldSetData>>;
  subgraphNames: Set<SubgraphName>;
  typeName: TypeName;
};

export type SimpleFieldData = {
  name: FieldName;
  namedTypeName: TypeName;
};

export type EntityInterfaceSubgraphData = {
  concreteTypeNames: Set<TypeName>;
  fieldDatas: Array<SimpleFieldData>;
  interfaceFieldNames: Set<FieldName>;
  interfaceObjectFieldNames: Set<FieldName>;
  isInterfaceObject: boolean;
  resolvable: boolean;
  typeName: TypeName;
};

export type FieldAuthorizationData = {
  fieldName: FieldName;
  inheritedData: InheritedAuthorizationData;
  originalData: OriginalAuthorizationData;
};

export type InheritedAuthorizationData = {
  requiredScopes: Array<Set<string>>;
  requiredScopesByOR: Array<Set<string>>;
  requiresAuthentication: boolean;
};

export type OriginalAuthorizationData = {
  requiredScopes: Array<Set<string>>;
  requiresAuthentication: boolean;
};

export type AuthorizationData = {
  fieldAuthDataByFieldName: Map<FieldName, FieldAuthorizationData>;
  requiredScopes: Array<Set<string>>;
  requiredScopesByOR: Array<Set<string>>;
  requiresAuthentication: boolean;
  typeName: TypeName;
};

export type ConditionalFieldData = {
  providedBy: Array<FieldSetConditionData>;
  requiredBy: Array<FieldSetConditionData>;
};

export type EntityInterfaceFederationData = {
  concreteTypeNames: Set<TypeName>;
  fieldDatasBySubgraphName: Map<SubgraphName, Array<SimpleFieldData>>;
  interfaceFieldNames: Set<FieldName>;
  interfaceObjectFieldNames: Set<FieldName>;
  interfaceObjectSubgraphNames: Set<SubgraphName>;
  subgraphDataByTypeName: Map<TypeName, EntityInterfaceSubgraphData>;
  typeName: TypeName;
};
