import { ConstDirectiveNode, DocumentNode, GraphQLSchema, Kind } from 'graphql';
import { ArgumentConfigurationData } from '../subgraph/field-configuration';
import {
  MutableDirectiveDefinitionNode,
  MutableEnumTypeDefinitionNode,
  MutableEnumValueDefinitionNode,
  MutableFieldDefinitionNode,
  MutableInputObjectTypeDefinitionNode,
  MutableInputValueDefinitionNode,
  MutableInterfaceTypeDefinitionNode,
  MutableObjectTypeDefinitionNode,
  MutableObjectTypeExtensionNode,
  MutableScalarTypeDefinitionNode,
  MutableUnionTypeDefinitionNode,
} from '../ast/ast';
import {
  FIELD_UPPER,
  FRAGMENT_DEFINITION_UPPER,
  FRAGMENT_SPREAD_UPPER,
  INLINE_FRAGMENT_UPPER,
  MUTATION_UPPER,
  QUERY_UPPER,
  SUBSCRIPTION_UPPER,
} from '../utils/string-constants';
import { SubgraphConfig } from '../subgraph/subgraph';

export type FederationResultContainer = {
  errors?: Error[];
  federationResult?: FederationResult;
};

export type FederationResult = {
  argumentConfigurations: ArgumentConfigurationData[];
  federatedGraphAST: DocumentNode;
  federatedGraphSchema: GraphQLSchema;
  subgraphConfigBySubgraphName: Map<string, SubgraphConfig>;
};

export type RootTypeFieldData = {
  fieldName: string;
  fieldTypeNodeString: string;
  path: string;
  typeName: string;
  subgraphs: Set<string>;
};

export const EXECUTABLE_DIRECTIVE_LOCATIONS = new Set<string>([
  FIELD_UPPER,
  FRAGMENT_DEFINITION_UPPER,
  FRAGMENT_SPREAD_UPPER,
  INLINE_FRAGMENT_UPPER,
  MUTATION_UPPER,
  QUERY_UPPER,
  SUBSCRIPTION_UPPER,
]);

export enum MergeMethod {
  UNION,
  INTERSECTION,
  CONSISTENT,
}

export type DeprecatedDirectiveContainer = {
  reason?: string;
  directive?: ConstDirectiveNode;
};

export type PersistedDirectivesContainer = {
  deprecated: DeprecatedDirectiveContainer;
  directives: Map<string, ConstDirectiveNode[]>;
  tags: Map<string, ConstDirectiveNode>;
};

export function newPersistedDirectivesContainer(): PersistedDirectivesContainer {
  return {
    deprecated: {},
    directives: new Map<string, ConstDirectiveNode[]>(),
    tags: new Map<string, ConstDirectiveNode>(),
  };
}

export type ArgumentContainer = {
  directives: PersistedDirectivesContainer;
  includeDefaultValue: boolean;
  node: MutableInputValueDefinitionNode;
  requiredSubgraphs: Set<string>;
  subgraphs: Set<string>;
};

export type ArgumentMap = Map<string, ArgumentContainer>;

export type DirectiveContainer = {
  arguments: ArgumentMap;
  executableLocations: Set<string>;
  node: MutableDirectiveDefinitionNode;
  subgraphs: Set<string>;
};

export type DirectiveMap = Map<string, DirectiveContainer>;

export type EntityContainer = {
  fields: Set<string>;
  subgraphs: Set<string>;
};

export type EnumContainer = {
  appearances: number;
  directives: PersistedDirectivesContainer;
  kind: Kind.ENUM_TYPE_DEFINITION;
  node: MutableEnumTypeDefinitionNode;
  values: EnumValueMap;
};

export type EnumValueContainer = {
  appearances: number;
  directives: PersistedDirectivesContainer;
  node: MutableEnumValueDefinitionNode;
};

export type EnumValueMap = Map<string, EnumValueContainer>;

export type FieldContainer = {
  arguments: ArgumentMap;
  directives: PersistedDirectivesContainer;
  isShareable: boolean;
  node: MutableFieldDefinitionNode;
  overrideTargetSubgraphName: string;
  namedTypeName: string;
  subgraphs: Set<string>;
  subgraphsByExternal: Map<String, boolean>;
  subgraphsByShareable: Map<string, boolean>;
};

export type FieldMap = Map<string, FieldContainer>;

export type InputValueContainer = {
  appearances: number;
  directives: PersistedDirectivesContainer;
  includeDefaultValue: boolean;
  node: MutableInputValueDefinitionNode;
};

export type InputValueMap = Map<string, InputValueContainer>;

export type InputObjectContainer = {
  appearances: number;
  directives: PersistedDirectivesContainer;
  fields: InputValueMap;
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION;
  node: MutableInputObjectTypeDefinitionNode;
};

export type InterfaceContainer = {
  directives: PersistedDirectivesContainer;
  fields: FieldMap;
  interfaces: Set<string>;
  kind: Kind.INTERFACE_TYPE_DEFINITION;
  node: MutableInterfaceTypeDefinitionNode;
  subgraphs: Set<string>;
};

export type ObjectContainer = {
  directives: PersistedDirectivesContainer;
  fields: FieldMap;
  interfaces: Set<string>;
  isRootType: boolean;
  kind: Kind.OBJECT_TYPE_DEFINITION;
  node: MutableObjectTypeDefinitionNode;
  subgraphs: Set<string>;
};

export type ObjectExtensionContainer = {
  directives: PersistedDirectivesContainer;
  fields: FieldMap;
  interfaces: Set<string>;
  isRootType: boolean;
  kind: Kind.OBJECT_TYPE_EXTENSION;
  node: MutableObjectTypeExtensionNode;
  subgraphs: Set<string>;
};

export type ScalarContainer = {
  directives: PersistedDirectivesContainer;
  kind: Kind.SCALAR_TYPE_DEFINITION;
  node: MutableScalarTypeDefinitionNode;
};

export type UnionContainer = {
  directives: PersistedDirectivesContainer;
  kind: Kind.UNION_TYPE_DEFINITION;
  members: Set<string>;
  node: MutableUnionTypeDefinitionNode;
};

export type ChildContainer = FieldContainer | InputValueContainer | EnumValueContainer;

export type ParentContainer =
  | EnumContainer
  | InputObjectContainer
  | InterfaceContainer
  | ObjectContainer
  | UnionContainer
  | ScalarContainer;

export type NodeContainer = ArgumentContainer | ChildContainer | ParentContainer;
export type ExtensionContainer = ObjectExtensionContainer;
export type ParentMap = Map<string, ParentContainer>;
export type ObjectLikeContainer = ObjectContainer | InterfaceContainer;
