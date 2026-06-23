import {
  type CompositeOutputData,
  type FieldData,
  type InputObjectDefinitionData,
  type InputValueData,
  type NodeData,
  type SchemaData,
} from '../../../schema-building/types/types';
import {
  type BooleanValueNode,
  type ConstDirectiveNode,
  type DocumentNode,
  type InputValueDefinitionNode,
  type IntValueNode,
  type Kind,
  type Location,
  type NameNode,
  type StringValueNode,
  type ValueNode,
} from 'graphql';
import { type RequiredFieldConfiguration } from '../../../router-configuration/types';
import {
  type ArgumentName,
  type DirectiveArgumentCoords,
  type DirectiveName,
  type FieldName,
  type SubgraphName,
  type TypeName,
} from '../../../types/types';
import { type ExecutionFailure, type ExecutionSuccess } from '../../../types/results';
import {
  type DirectiveArgumentData,
  type DirectiveDefinitionData,
} from '../../../directive-definition-data/types/types';
import {
  type INCLUDE_HEADERS,
  type MAX_AGE,
  type NEGATIVE_CACHE_TTL,
  type OPENFED_CACHE_POPULATE,
  type OPENFED_ENTITY_CACHE,
  type PARTIAL_CACHE_LOAD,
  type SHADOW_MODE,
} from '../../../utils/string-constants';

export type KeyFieldSetData = {
  documentNode: DocumentNode;
  isUnresolvable: boolean;
  normalizedFieldSet: string;
  rawFieldSet: string;
};

export type FieldSetData = {
  provides: Map<string, string>;
  requires: Map<string, string>;
};

export type ConditionalFieldSetValidationResult = {
  errorMessages: Array<string>;
  configuration?: RequiredFieldConfiguration;
};

export type FieldSetParentResult = {
  errorString?: string;
  fieldSetParentData?: CompositeOutputData;
};

export type ExtractDirectiveArgumentDataResult = {
  argumentDataByName: Map<ArgumentName, DirectiveArgumentData>;
  optionalArgumentNames: Set<ArgumentName>;
  requiredArgumentNames: Set<ArgumentName>;
};

export type ValidateDirectiveParams = {
  data: NodeData | SchemaData;
  definitionData: DirectiveDefinitionData;
  directiveCoords: string;
  directiveNode: ConstDirectiveNode;
  errorMessages: Array<string>;
  requiredArgumentNames: Array<ArgumentName>;
};

export type HandleOverrideDirectiveParams = {
  data: FieldData;
  directiveCoords: string;
  errorMessages: Array<string>;
  targetSubgraphName: SubgraphName;
};

export type HandleRequiresScopesDirectiveParams = {
  directiveCoords: string;
  orScopes: ReadonlyArray<ValueNode>;
  requiredScopes: Array<Set<string>>;
};

export type HandleSemanticNonNullDirectiveParams = {
  data: FieldData;
  directiveNode: ConstDirectiveNode;
  errorMessages: Array<string>;
};

export type HandleCostDirectiveParams = {
  data: NodeData | SchemaData;
  directiveCoords: DirectiveArgumentCoords;
  directiveNode: ConstDirectiveNode;
  errorMessages: Array<string>;
};

export type HandleListSizeDirectiveParams = {
  data: FieldData;
  directiveCoords: DirectiveArgumentCoords;
  directiveNode: ConstDirectiveNode;
  errorMessages: Array<string>;
};

export type RecordDirectiveWeightOnFieldParams = {
  data: FieldData;
  definitionData: DirectiveDefinitionData;
  directiveName: DirectiveName;
  directiveNode: ConstDirectiveNode;
};

export type AddInputValueDataByNodeParams = {
  inputValueDataByName: Map<FieldName, InputValueData>;
  isArgument: boolean;
  node: InputValueDefinitionNode;
  originalParentTypeName: TypeName;
  fieldName?: FieldName;
  renamedParentTypeName?: TypeName;
};

export interface UpsertInputObjectSuccess extends ExecutionSuccess {
  data: InputObjectDefinitionData;
}

export type UpsertInputObjectResult = ExecutionFailure | UpsertInputObjectSuccess;

export type ComposeDirectiveNode = {
  readonly arguments: ReadonlyArray<ComposeDirectiveArgumentNode>;
  readonly kind: Kind.DIRECTIVE;
  readonly name: NameNode;
  readonly loc?: Location;
};

export type ComposeDirectiveArgumentNode = {
  readonly kind: Kind.ARGUMENT;
  readonly name: NameNode;
  readonly value: StringValueNode;
  readonly loc?: Location;
};

export type RequestScopedDirectiveNode = {
  readonly arguments: ReadonlyArray<RequestScopedArgumentNode>;
  readonly kind: Kind.DIRECTIVE;
  readonly name: NameNode;
  readonly loc?: Location;
};

export type RequestScopedArgumentNode = {
  readonly kind: Kind.ARGUMENT;
  readonly name: NameNode;
  readonly value: StringValueNode; // key: String! — guaranteed by validateDirectives()
  readonly loc?: Location;
};

export type EntityCacheDirectiveNode = {
  readonly arguments:
    | readonly [MaxAgeArgumentNode]
    | readonly [
        MaxAgeArgumentNode,
        NegativeCacheTtlArgumentNode?,
        IncludeHeadersArgumentNode?,
        PartialCacheLoadArgumentNode?,
        ShadowModeArgumentNode?,
      ];
  readonly kind: Kind.DIRECTIVE;
  readonly name: NameNode & { readonly value: typeof OPENFED_ENTITY_CACHE };
  readonly loc?: Location;
};

export type EntityCacheOptionalArgumentNodes =
  | NegativeCacheTtlArgumentNode
  | IncludeHeadersArgumentNode
  | PartialCacheLoadArgumentNode
  | ShadowModeArgumentNode;

export type MaxAgeArgumentNode = {
  readonly kind: Kind.ARGUMENT;
  readonly name: NameNode & { readonly value: typeof MAX_AGE };
  readonly value: IntValueNode;
  readonly loc?: Location;
};

export type NegativeCacheTtlArgumentNode = {
  readonly kind: Kind.ARGUMENT;
  readonly name: NameNode & { readonly value: typeof NEGATIVE_CACHE_TTL };
  readonly value: IntValueNode;
  readonly loc?: Location;
};

export type IncludeHeadersArgumentNode = {
  readonly kind: Kind.ARGUMENT;
  readonly name: NameNode & { readonly value: typeof INCLUDE_HEADERS };
  readonly value: BooleanValueNode;
  readonly loc?: Location;
};

export type PartialCacheLoadArgumentNode = {
  readonly kind: Kind.ARGUMENT;
  readonly name: NameNode & { readonly value: typeof PARTIAL_CACHE_LOAD };
  readonly value: BooleanValueNode;
  readonly loc?: Location;
};

export type ShadowModeArgumentNode = {
  readonly kind: Kind.ARGUMENT;
  readonly name: NameNode & { readonly value: typeof SHADOW_MODE };
  readonly value: BooleanValueNode;
  readonly loc?: Location;
};

export type QueryCacheDirectiveNode = {
  readonly arguments: ReadonlyArray<QueryCacheArgumentNode>;
  readonly kind: Kind.DIRECTIVE;
  readonly name: NameNode;
  readonly loc?: Location;
};

export type QueryCacheArgumentNode = {
  readonly kind: Kind.ARGUMENT;
  readonly name: NameNode;
  // maxAge is Int; includeHeaders/shadowMode are Boolean.
  // validateDirectives() guarantees each argument's value matches its declared type.
  readonly value: IntValueNode | BooleanValueNode;
  readonly loc?: Location;
};

export type CachePopulateDirectiveNode = {
  readonly arguments: ReadonlyArray<CachePopulateArgumentNode>;
  readonly kind: Kind.DIRECTIVE;
  readonly name: NameNode & { readonly value: typeof OPENFED_CACHE_POPULATE };
  readonly loc?: Location;
};

export type CachePopulateArgumentNode = {
  readonly kind: Kind.ARGUMENT;
  readonly name: NameNode & { readonly value: typeof MAX_AGE };
  readonly value: IntValueNode;
  readonly loc?: Location;
};

export type LinkImportData = {
  name: DirectiveName;
  coreUrl: string;
  majorVersion: number;
  minorVersion: number;
  node?: ConstDirectiveNode;
  rename?: DirectiveName;
};
