import { ConstDirectiveNode, Kind, NamedTypeNode } from 'graphql';
import { EnumValueData, FieldData, InputValueData } from './type-definition-data';
import { MutableObjectExtensionNode } from './ast';

export type EnumExtensionData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  enumValueDataByValueName: Map<string, EnumValueData>;
  kind: Kind.ENUM_TYPE_EXTENSION;
  typeName: string;
};

export type ObjectExtensionData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  fieldDataByFieldName: Map<string, FieldData>;
  implementedInterfaceTypeNames: Set<string>;
  isEntity: boolean;
  kind: Kind.OBJECT_TYPE_EXTENSION;
  node: MutableObjectExtensionNode;
  typeName: string;
};

export type InputObjectExtensionData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  inputValueDataByValueName: Map<string, InputValueData>;
  kind: Kind.INPUT_OBJECT_TYPE_EXTENSION;
  typeName: String;
};

export type InterfaceExtensionData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  fieldDataByFieldName: Map<string, FieldData>;
  implementedInterfaceTypeNames: Set<string>;
  isEntity: boolean;
  kind: Kind.INTERFACE_TYPE_EXTENSION;
  typeName: string;
};

export type ScalarExtensionData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  kind: Kind.SCALAR_TYPE_EXTENSION;
  typeName: string;
};

export type UnionExtensionData = {
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  kind: Kind.UNION_TYPE_EXTENSION;
  memberByMemberTypeName: Map<string, NamedTypeNode>;
  typeName: string;
};

export type ParentExtensionData =
  | EnumExtensionData
  | InputObjectExtensionData
  | InterfaceExtensionData
  | ObjectExtensionData
  | ScalarExtensionData
  | UnionExtensionData;

export type ExtensionWithFieldsData = InterfaceExtensionData | ObjectExtensionData;
