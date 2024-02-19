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

export type ArgumentData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  name: string;
  node: MutableInputValueNode;
  requiredSubgraphNames: Set<string>;
  subgraphNames: Set<string>;
  type: MutableTypeNode;
  defaultValue?: ConstValueNode;
  description?: StringValueNode;
};

export type EnumDefinitionData = {
  appearances: number;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  enumValueDataByValueName: Map<string, EnumValueData>;
  kind: Kind.ENUM_TYPE_DEFINITION;
  typeName: string;
  node: MutableEnumNode;
  description?: StringValueNode;
};

export type EnumValueData = {
  appearances: number;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  name: string;
  node: MutableEnumValueNode;
  parentTypeName: string;
  description?: StringValueNode;
};

export type FieldData = {
  argumentDataByArgumentName: Map<string, ArgumentData>;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  isExternalBySubgraphName: Map<string, boolean>;
  isShareableBySubgraphName: Map<string, boolean>;
  name: string;
  namedTypeName: string;
  node: MutableFieldNode;
  parentTypeName: string;
  subgraphNames: Set<string>;
  description?: StringValueNode;
};

export type InputObjectDefinitionData = {
  appearances: number;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  inputValueDataByValueName: Map<string, InputValueData>;
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION;
  typeName: string;
  node: MutableInputObjectNode;
  description?: StringValueNode;
};

export type InputValueData = {
  appearances: number;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  name: string;
  node: MutableInputValueNode;
  parentTypeName: string;
  description?: StringValueNode;
};

export type InterfaceData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  fieldDataByFieldName: Map<string, FieldData>;
  implementedInterfaceTypeNames: Set<string>;
  isEntity: boolean;
  kind: Kind.INTERFACE_TYPE_DEFINITION;
  typeName: string;
  node: MutableInterfaceNode;
  subgraphNames: Set<string>;
  description?: StringValueNode;
};

export type ObjectData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  fieldDataByFieldName: Map<string, FieldData>;
  implementedInterfaceTypeNames: Set<string>;
  isEntity: boolean;
  isRootType: boolean;
  kind: Kind.OBJECT_TYPE_DEFINITION;
  typeName: string;
  node: MutableObjectNode;
  subgraphNames: Set<string>;
  description?: StringValueNode;
};

export type ScalarDefinitionData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  kind: Kind.SCALAR_TYPE_DEFINITION;
  typeName: string;
  node: MutableScalarNode;
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
  typeName: string;
  memberByMemberTypeName: Map<string, NamedTypeNode>;
  node: MutableUnionNode;
  description?: StringValueNode;
};

export type ParentDefinitionData =
  | EnumDefinitionData
  | InputObjectDefinitionData
  | InterfaceData
  | ObjectData
  | ScalarDefinitionData
  | UnionDefinitionData;

export type ParentWithFieldsData = DefinitionWithFieldsData | ExtensionWithFieldsData;

export type ChildData = EnumValueData | FieldData | InputValueData;

export type DefinitionWithFieldsData = InterfaceData | ObjectData;
