import { ConstDirectiveNode, DocumentNode, GraphQLSchema } from 'graphql';
import {
  ConfigurationData,
  FieldConfiguration,
  RequiredFieldConfiguration,
} from '../router-configuration/router-configuration';
import { InternalSubgraph, SubgraphConfig } from '../subgraph/subgraph';
import {
  DefinitionWithFieldsData,
  FieldData,
  InterfaceDefinitionData,
  ObjectDefinitionData,
  ParentDefinitionData,
  ParentWithFieldsData,
} from '../schema-building/type-definition-data';
import { addIterableValuesToSet, AuthorizationData, EntityData, EntityInterfaceFederationData } from '../utils/utils';
import { Graph } from '../resolvability-graph/graph';
import { getTypeNodeNamedTypeName, MutableFieldNode } from '../schema-building/ast';
import { BREAK, Kind, visit } from 'graphql/index';
import { BASE_SCALARS } from '../utils/constants';
import { isKindAbstract, safeParse } from '../ast/utils';
import { ObjectExtensionData, ParentExtensionData } from '../schema-building/type-extension-data';
import { getNormalizedFieldSet } from '../normalization/utils';
import { GraphNode } from '../resolvability-graph/graph-nodes';

export type FederationFactoryOptions = {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  entityDataByTypeName: Map<string, EntityData>;
  entityInterfaceFederationDataByTypeName: Map<string, EntityInterfaceFederationData>;
  internalGraph: Graph;
  internalSubgraphBySubgraphName: Map<string, InternalSubgraph>;
  warnings?: string[];
};

export type FederationResultContainer = {
  errors?: Error[];
  federationResult?: FederationResult;
  warnings?: String[];
};

export type FederationResult = {
  fieldConfigurations: FieldConfiguration[];
  federatedGraphAST: DocumentNode;
  federatedGraphClientSchema: GraphQLSchema;
  federatedGraphSchema: GraphQLSchema;
  subgraphConfigBySubgraphName: Map<string, SubgraphConfig>;
  shouldIncludeClientSchema?: boolean;
};

export type FederationResultContainerWithContracts = {
  errors?: Error[];
  federationResult?: FederationResult;
  federationResultContainerByContractName?: Map<string, FederationResultContainer>;
  warnings?: String[];
};

export type RootTypeFieldData = {
  fieldName: string;
  fieldTypeNodeString: string;
  path: string;
  typeName: string;
  subgraphs: Set<string>;
};

export type ParentTagData = {
  childTagDataByChildName: Map<string, ChildTagData>;
  tagNames: Set<string>;
  typeName: string;
};

export function newParentTagData(typeName: string): ParentTagData {
  return {
    childTagDataByChildName: new Map<string, ChildTagData>(),
    tagNames: new Set<string>(),
    typeName,
  };
}

export type ChildTagData = {
  name: string;
  tagNames: Set<string>;
  tagNamesByArgumentName: Map<string, Set<string>>;
};

export function newChildTagData(name: string): ChildTagData {
  return {
    name,
    tagNames: new Set<string>(),
    tagNamesByArgumentName: new Map<string, Set<string>>(),
  };
}

export type InterfaceImplementationData = {
  data: DefinitionWithFieldsData;
  clientSchemaFieldNodes: MutableFieldNode[];
};

export type SubscriptionFilterData = {
  directive: ConstDirectiveNode;
  directiveSubgraphName: string;
  fieldData: FieldData;
};

export type VisitFieldSetOptions = {
  configurationData: ConfigurationData;
  fieldSets: Set<string>;
  implicitKeys: Array<RequiredFieldConfiguration>;
  objectData: ObjectDefinitionData | ObjectExtensionData | InterfaceDefinitionData;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  parentExtensionDataByTypeName: Map<string, ParentExtensionData>;
  graphNode?: GraphNode;
};

export type InterfaceObjectForInternalGraphOptions = {
  entityData: EntityData;
  interfaceObjectData: EntityInterfaceFederationData;
  interfaceObjectNode: GraphNode;
  internalSubgraph: InternalSubgraph;
  resolvableKeyFieldSets: Set<string>;
  subgraphName: string;
};

export function validateImplicitFieldSets({
  configurationData,
  fieldSets,
  implicitKeys,
  objectData,
  parentDefinitionDataByTypeName,
  parentExtensionDataByTypeName,
  graphNode,
}: VisitFieldSetOptions) {
  for (const fieldSet of fieldSets) {
    // Create a new selection set so that the value can be parsed as a new DocumentNode
    const { error, documentNode } = safeParse('{' + fieldSet + '}');
    if (error || !documentNode) {
      // This would be caught as an error elsewhere
      continue;
    }
    const parentDatas: ParentWithFieldsData[] = [objectData];
    const definedFields: Set<string>[] = [];
    const keyFieldNames = new Set<string>();
    let currentDepth = -1;
    let shouldDefineSelectionSet = true;
    let shouldAddKeyFieldSet = true;
    visit(documentNode, {
      Argument: {
        enter() {
          // Fields that define arguments are never allowed in a key FieldSet
          // However, at this stage, it actually means the argument is undefined on the field
          shouldAddKeyFieldSet = false;
          return BREAK;
        },
      },
      Field: {
        enter(node) {
          const parentData = parentDatas[currentDepth];
          // If an object-like was just visited, a selection set should have been entered
          if (shouldDefineSelectionSet) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          const fieldName = node.name.value;
          const fieldData = parentData.fieldDataByFieldName.get(fieldName);
          // undefined if the field does not exist on the parent
          if (!fieldData || fieldData.argumentDataByArgumentName.size || definedFields[currentDepth].has(fieldName)) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          definedFields[currentDepth].add(fieldName);
          // Depth 0 is the original parent type
          // If a field is external, but it's part of a key FieldSet, it will be included in the root configuration
          if (currentDepth === 0) {
            keyFieldNames.add(fieldName);
          }
          const namedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
          // The base scalars are not in the parents map
          if (BASE_SCALARS.has(namedTypeName)) {
            return;
          }
          // The child could itself be a parent and could exist as an object extension
          const fieldNamedTypeData =
            parentDefinitionDataByTypeName.get(namedTypeName) || parentExtensionDataByTypeName.get(namedTypeName);
          if (!fieldNamedTypeData) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          if (
            fieldNamedTypeData.kind === Kind.OBJECT_TYPE_DEFINITION ||
            fieldNamedTypeData.kind === Kind.OBJECT_TYPE_EXTENSION
          ) {
            shouldDefineSelectionSet = true;
            parentDatas.push(fieldNamedTypeData);
            return;
          }
          // interfaces and unions are invalid in a key directive
          if (isKindAbstract(fieldNamedTypeData.kind)) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
        },
      },
      InlineFragment: {
        enter() {
          shouldAddKeyFieldSet = false;
          return BREAK;
        },
      },
      SelectionSet: {
        enter() {
          if (!shouldDefineSelectionSet) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          currentDepth += 1;
          shouldDefineSelectionSet = false;
          if (currentDepth < 0 || currentDepth >= parentDatas.length) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          definedFields.push(new Set<string>());
        },
        leave() {
          if (shouldDefineSelectionSet) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          // Empty selection sets would be a parse error, so it is unnecessary to handle them
          currentDepth -= 1;
          parentDatas.pop();
          definedFields.pop();
        },
      },
    });
    if (!shouldAddKeyFieldSet) {
      continue;
    }
    // Add any top-level fields that compose the key in case they are external
    addIterableValuesToSet(keyFieldNames, configurationData.fieldNames);
    const normalizedFieldSet = getNormalizedFieldSet(documentNode);
    implicitKeys.push({
      fieldName: '',
      selectionSet: normalizedFieldSet,
      disableEntityResolver: true,
    });
    if (graphNode) {
      graphNode.satisfiedFieldSets.add(normalizedFieldSet);
    }
  }
}
