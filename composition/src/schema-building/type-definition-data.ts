import {
  ConstDirectiveNode,
  ConstValueNode,
  Kind,
  NamedTypeNode,
  OperationTypeDefinitionNode,
  OperationTypeNode,
  StringValueNode,
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
import { ExtensionWithFieldsData } from './type-extension-data';

export type EnumDefinitionData = {
  appearances: number;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  enumValueDataByValueName: Map<string, EnumValueData>;
  kind: Kind.ENUM_TYPE_DEFINITION;
  name: string;
  node: MutableEnumNode;
  persistedDirectivesData: PersistedDirectivesData;
  description?: StringValueNode;
};

export type EnumValueData = {
  appearances: number;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  name: string;
  node: MutableEnumValueNode;
  parentTypeName: string;
  persistedDirectivesData: PersistedDirectivesData;
  description?: StringValueNode;
};

export type FieldData = {
  argumentDataByArgumentName: Map<string, InputValueData>;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  isExternalBySubgraphName: Map<string, boolean>;
  isInaccessible: boolean;
  isShareableBySubgraphName: Map<string, boolean>;
  name: string;
  namedTypeName: string;
  node: MutableFieldNode;
  parentTypeName: string;
  persistedDirectivesData: PersistedDirectivesData;
  subgraphNames: Set<string>;
  type: MutableTypeNode;
  description?: StringValueNode;
};

export type InputObjectDefinitionData = {
  appearances: number;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  inputValueDataByValueName: Map<string, InputValueData>;
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION;
  name: string;
  node: MutableInputObjectNode;
  persistedDirectivesData: PersistedDirectivesData;
  description?: StringValueNode;
};

export type InputValueData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  includeDefaultValue: boolean;
  isArgument: boolean;
  name: string;
  node: MutableInputValueNode;
  path: string;
  persistedDirectivesData: PersistedDirectivesData;
  requiredSubgraphNames: Set<string>;
  subgraphNames: Set<string>;
  type: MutableTypeNode;
  defaultValue?: ConstValueNode;
  description?: StringValueNode;
};

export type InterfaceDefinitionData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  fieldDataByFieldName: Map<string, FieldData>;
  implementedInterfaceTypeNames: Set<string>;
  isEntity: boolean;
  kind: Kind.INTERFACE_TYPE_DEFINITION;
  name: string;
  node: MutableInterfaceNode;
  persistedDirectivesData: PersistedDirectivesData;
  subgraphNames: Set<string>;
  description?: StringValueNode;
};

export type ObjectDefinitionData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  fieldDataByFieldName: Map<string, FieldData>;
  implementedInterfaceTypeNames: Set<string>;
  isEntity: boolean; // TODO required?
  isRootType: boolean; // TODO required?
  kind: Kind.OBJECT_TYPE_DEFINITION;
  name: string;
  node: MutableObjectNode;
  persistedDirectivesData: PersistedDirectivesData;
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
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  kind: Kind.SCALAR_TYPE_DEFINITION;
  name: string;
  node: MutableScalarNode;
  persistedDirectivesData: PersistedDirectivesData;
  description?: StringValueNode;
};

export type SchemaData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  kind: Kind.SCHEMA_DEFINITION;
  typeName: string;
  operationTypes: Map<OperationTypeNode, OperationTypeDefinitionNode>;
  description?: StringValueNode;
};

export type UnionDefinitionData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
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

export type ParentWithFieldsData = DefinitionWithFieldsData | ExtensionWithFieldsData;

export type ChildData = EnumValueData | FieldData | InputValueData;

export type DefinitionWithFieldsData = InterfaceDefinitionData | ObjectDefinitionData;

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

export type TypedChildData = FieldData | InputValueData;
