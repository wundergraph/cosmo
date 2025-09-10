import { BREAK, ConstDirectiveNode, DocumentNode, Kind, OperationTypeNode, print, visit } from 'graphql';
import { isKindAbstract, lexicographicallySortDocumentNode } from '../../ast/utils';
import { NormalizationFactory } from './normalization-factory';
import {
  abstractTypeInKeyFieldSetErrorMessage,
  argumentsInKeyFieldSetErrorMessage,
  duplicateFieldInFieldSetErrorMessage,
  inlineFragmentInFieldSetErrorMessage,
  invalidDirectiveError,
  invalidEventSubjectsArgumentErrorMessage,
  invalidSelectionSetDefinitionErrorMessage,
  invalidSelectionSetErrorMessage,
  undefinedEventSubjectsArgumentErrorMessage,
  undefinedFieldInFieldSetErrorMessage,
  unexpectedArgumentErrorMessage,
  unknownTypeInFieldSetErrorMessage,
  unparsableFieldSetSelectionErrorMessage,
} from '../../errors/errors';
import { BASE_SCALARS, EDFS_ARGS_REGEXP } from '../utils/constants';
import { RequiredFieldConfiguration } from '../../router-configuration/types';
import { CompositeOutputData, DirectiveDefinitionData, InputValueData } from '../../schema-building/types';
import { getTypeNodeNamedTypeName } from '../../schema-building/ast';
import {
  AUTHENTICATED_DEFINITION_DATA,
  COMPOSE_DIRECTIVE_DEFINITION_DATA,
  CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION_DATA,
  CONFIGURE_DESCRIPTION_DEFINITION_DATA,
  DEPRECATED_DEFINITION_DATA,
  EXTENDS_DEFINITION_DATA,
  EXTERNAL_DEFINITION_DATA,
  INACCESSIBLE_DEFINITION_DATA,
  INTERFACE_OBJECT_DEFINITION_DATA,
  KAFKA_PUBLISH_DEFINITION_DATA,
  KAFKA_SUBSCRIBE_DEFINITION_DATA,
  KEY_DEFINITION_DATA,
  LINK_DEFINITION_DATA,
  NATS_PUBLISH_DEFINITION_DATA,
  NATS_REQUEST_DEFINITION_DATA,
  NATS_SUBSCRIBE_DEFINITION_DATA,
  OVERRIDE_DEFINITION_DATA,
  PROVIDES_DEFINITION_DATA,
  REDIS_PUBLISH_DEFINITION_DATA,
  REDIS_SUBSCRIBE_DEFINITION_DATA,
  REQUIRE_FETCH_REASONS_DEFINITION_DATA,
  REQUIRES_DEFINITION_DATA,
  REQUIRES_SCOPES_DEFINITION_DATA,
  SHAREABLE_DEFINITION_DATA,
  SPECIFIED_BY_DEFINITION_DATA,
  SUBSCRIPTION_FILTER_DEFINITION_DATA,
  TAG_DEFINITION_DATA,
} from './directive-definition-data';
import {
  AUTHENTICATED,
  COMPOSE_DIRECTIVE,
  CONFIGURE_CHILD_DESCRIPTIONS,
  CONFIGURE_DESCRIPTION,
  DEPRECATED,
  EDFS_KAFKA_PUBLISH,
  EDFS_KAFKA_SUBSCRIBE,
  EDFS_NATS_PUBLISH,
  EDFS_NATS_REQUEST,
  EDFS_NATS_SUBSCRIBE,
  EDFS_REDIS_PUBLISH,
  EDFS_REDIS_SUBSCRIBE,
  EXTENDS,
  EXTERNAL,
  FIELDS,
  INACCESSIBLE,
  INTERFACE_OBJECT,
  KEY,
  LINK,
  OVERRIDE,
  PERIOD,
  PROVIDES,
  QUERY,
  REQUIRE_FETCH_REASONS,
  REQUIRES,
  REQUIRES_SCOPES,
  SHAREABLE,
  SPECIFIED_BY,
  SUBSCRIPTION_FILTER,
  TAG,
} from '../../utils/string-constants';
import { getValueOrDefault, kindToNodeType, numberToOrdinal } from '../../utils/utils';
import { FieldSetData, KeyFieldSetData } from './types';

export function newFieldSetData(): FieldSetData {
  return {
    provides: new Map<string, string>(),
    requires: new Map<string, string>(),
  };
}

export function extractFieldSetValue(name: string, map: Map<string, string>, directives?: ConstDirectiveNode[]) {
  // ALl directive validation errors are accounted for later
  // Requires and provides should not be repeatable, so the length should be no more than 1
  if (!directives || directives.length > 1) {
    return;
  }
  // There should be exactly one argument
  const args = directives[0].arguments;
  if (!args || args.length !== 1) {
    return;
  }
  // The argument should be a string type named "fields"
  const fieldsArgument = args[0];
  if (fieldsArgument.name.value !== FIELDS || fieldsArgument.value.kind !== Kind.STRING) {
    return;
  }
  map.set(name, fieldsArgument.value.value);
}

export function getNormalizedFieldSet(documentNode: DocumentNode): string {
  /*
    1. Lexicographically sort the DocumentNode
    2. Convert to a string
    3. Replace consecutive whitespace with a single space
    4. Remove the leading and trailing "{ " and " }", respectively
  */
  return print(lexicographicallySortDocumentNode(documentNode)).replaceAll(/\s+/g, ' ').slice(2, -2);
}

export function getInitialFieldCoordsPath(isProvides: boolean, directiveCoords: string): Array<string> {
  if (isProvides) {
    return [directiveCoords];
  }
  return [];
}

export function validateKeyFieldSets(
  nf: NormalizationFactory,
  entityParentData: CompositeOutputData,
  keyFieldSetDataByFieldSet: Map<string, KeyFieldSetData>,
): RequiredFieldConfiguration[] | undefined {
  const entityInterfaceData = nf.entityInterfaceDataByTypeName.get(entityParentData.name);
  const entityTypeName = entityParentData.name;
  const configurations: RequiredFieldConfiguration[] = [];
  const allKeyFieldSetPaths: Array<Set<string>> = [];
  // If the key is on an entity interface/interface object, an entity data node should not be propagated
  const entityDataNode = entityInterfaceData ? undefined : nf.internalGraph.addEntityDataNode(entityParentData.name);
  const graphNode = nf.internalGraph.addOrUpdateNode(entityParentData.name);
  let keyNumber = 0;
  for (const [fieldSet, { documentNode, isUnresolvable, rawFieldSet }] of keyFieldSetDataByFieldSet) {
    if (entityInterfaceData) {
      entityInterfaceData.resolvable ||= !isUnresolvable;
    }
    keyNumber += 1;
    const errorMessages: Array<string> = [];
    const parentDatas: CompositeOutputData[] = [entityParentData];
    const definedFields: Array<Set<string>> = [];
    const currentPath: Array<string> = [];
    const keyFieldSetPaths = new Set<string>();
    let currentDepth = -1;
    let shouldDefineSelectionSet = true;
    let lastFieldName = '';
    visit(documentNode, {
      Argument: {
        enter(node) {
          // Fields that define arguments are never allowed in a key FieldSet
          // However, at this stage, it actually means the argument is undefined on the field
          errorMessages.push(
            unexpectedArgumentErrorMessage(
              rawFieldSet,
              `${parentDatas[currentDepth].name}.${lastFieldName}`,
              node.name.value,
            ),
          );
          return BREAK;
        },
      },
      Field: {
        enter(node) {
          const parentData = parentDatas[currentDepth];
          const parentTypeName = parentData.name;
          // If a composite type was just visited, a selection set should have been entered
          if (shouldDefineSelectionSet) {
            const lastFieldCoords = `${parentTypeName}.${lastFieldName}`;
            const lastFieldData = parentData.fieldDataByName.get(lastFieldName);
            if (!lastFieldData) {
              errorMessages.push(undefinedFieldInFieldSetErrorMessage(rawFieldSet, lastFieldCoords, lastFieldName));
              return BREAK;
            }
            const lastFieldNamedTypeName = getTypeNodeNamedTypeName(lastFieldData.node.type);
            // If the child is not found, it's a base scalar. Undefined types would have already been handled.
            const namedTypeData = nf.parentDefinitionDataByTypeName.get(lastFieldNamedTypeName);
            const namedTypeKind = namedTypeData ? namedTypeData.kind : Kind.SCALAR_TYPE_DEFINITION;
            errorMessages.push(
              invalidSelectionSetErrorMessage(
                rawFieldSet,
                [lastFieldCoords],
                lastFieldNamedTypeName,
                kindToNodeType(namedTypeKind),
              ),
            );
            return BREAK;
          }
          const fieldName = node.name.value;
          const fieldCoords = `${parentTypeName}.${fieldName}`;
          lastFieldName = fieldName;
          const fieldData = parentData.fieldDataByName.get(fieldName);
          // undefined if the field does not exist on the parent
          if (!fieldData) {
            errorMessages.push(undefinedFieldInFieldSetErrorMessage(rawFieldSet, parentTypeName, fieldName));
            return BREAK;
          }
          // TODO navigate already provided keys
          if (fieldData.argumentDataByName.size) {
            errorMessages.push(argumentsInKeyFieldSetErrorMessage(rawFieldSet, fieldCoords));
            return BREAK;
          }
          if (definedFields[currentDepth].has(fieldName)) {
            errorMessages.push(duplicateFieldInFieldSetErrorMessage(rawFieldSet, fieldCoords));
            return BREAK;
          }
          // Add the field set for which the field coordinates contribute a key field
          getValueOrDefault(
            getValueOrDefault(
              nf.keyFieldSetsByEntityTypeNameByFieldCoords,
              fieldCoords,
              () => new Map<string, Set<string>>(),
            ),
            entityTypeName,
            () => new Set<string>(),
          ).add(fieldSet);
          currentPath.push(fieldName);
          // Fields that form part of an entity key are intrinsically shareable
          fieldData.isShareableBySubgraphName.set(nf.subgraphName, true);
          definedFields[currentDepth].add(fieldName);
          getValueOrDefault(nf.keyFieldNamesByParentTypeName, parentTypeName, () => new Set<string>()).add(fieldName);
          const namedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
          // The base scalars are not in the parents map
          if (BASE_SCALARS.has(namedTypeName)) {
            keyFieldSetPaths.add(currentPath.join(PERIOD));
            currentPath.pop();
            return;
          }
          // The child could itself be a parent
          const namedTypeData = nf.parentDefinitionDataByTypeName.get(namedTypeName);
          if (!namedTypeData) {
            // Should not be possible to receive this error
            errorMessages.push(unknownTypeInFieldSetErrorMessage(rawFieldSet, fieldCoords, namedTypeName));
            return BREAK;
          }
          if (namedTypeData.kind === Kind.OBJECT_TYPE_DEFINITION) {
            shouldDefineSelectionSet = true;
            parentDatas.push(namedTypeData);
            return;
          }
          // interfaces and unions are invalid in a key directive
          if (isKindAbstract(namedTypeData.kind)) {
            errorMessages.push(
              abstractTypeInKeyFieldSetErrorMessage(
                rawFieldSet,
                fieldCoords,
                namedTypeName,
                kindToNodeType(namedTypeData.kind),
              ),
            );
            return BREAK;
          }
          keyFieldSetPaths.add(currentPath.join(PERIOD));
          currentPath.pop();
        },
      },
      InlineFragment: {
        enter() {
          errorMessages.push(inlineFragmentInFieldSetErrorMessage);
          return BREAK;
        },
      },
      SelectionSet: {
        enter() {
          if (!shouldDefineSelectionSet) {
            const parentData = parentDatas[currentDepth];
            const parentTypeName = parentData.name;
            const fieldCoordinates = `${parentTypeName}.${lastFieldName}`;
            // If the last field is not an object-like
            const fieldData = parentData.fieldDataByName.get(lastFieldName);
            if (!fieldData) {
              errorMessages.push(undefinedFieldInFieldSetErrorMessage(rawFieldSet, fieldCoordinates, lastFieldName));
              return BREAK;
            }
            const fieldNamedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
            // If the child is not found, it's a base scalar. Undefined types would have already been handled.
            const namedTypeData = nf.parentDefinitionDataByTypeName.get(fieldNamedTypeName);
            const namedTypeKind = namedTypeData ? namedTypeData.kind : Kind.SCALAR_TYPE_DEFINITION;
            errorMessages.push(
              invalidSelectionSetDefinitionErrorMessage(
                rawFieldSet,
                [fieldCoordinates],
                fieldNamedTypeName,
                kindToNodeType(namedTypeKind),
              ),
            );
            return BREAK;
          }
          currentDepth += 1;
          shouldDefineSelectionSet = false;
          if (currentDepth < 0 || currentDepth >= parentDatas.length) {
            errorMessages.push(unparsableFieldSetSelectionErrorMessage(rawFieldSet, lastFieldName));
            return BREAK;
          }
          definedFields.push(new Set<string>());
        },
        leave() {
          if (shouldDefineSelectionSet) {
            const grandparentData = parentDatas[currentDepth];
            const grandparentTypeName = grandparentData.name;
            const parentData = parentDatas[currentDepth + 1];
            const fieldCoordinates = `${grandparentTypeName}.${lastFieldName}`;
            errorMessages.push(
              invalidSelectionSetErrorMessage(
                rawFieldSet,
                [fieldCoordinates],
                parentData.name,
                kindToNodeType(parentData.kind),
              ),
            );
            shouldDefineSelectionSet = false;
          }
          // Empty selection sets would be a parse error, so it is unnecessary to handle them
          currentDepth -= 1;
          parentDatas.pop();
          definedFields.pop();
        },
      },
    });
    if (errorMessages.length > 0) {
      nf.errors.push(invalidDirectiveError(KEY, entityTypeName, numberToOrdinal(keyNumber), errorMessages));
      continue;
    }
    configurations.push({
      fieldName: '',
      selectionSet: fieldSet,
      ...(isUnresolvable ? { disableEntityResolver: true } : {}),
    });
    graphNode.satisfiedFieldSets.add(fieldSet);
    if (isUnresolvable) {
      continue;
    }
    entityDataNode?.addTargetSubgraphByFieldSet(fieldSet, nf.subgraphName);
    allKeyFieldSetPaths.push(keyFieldSetPaths);
  }
  // todo
  // nf.internalGraph.addEntityNode(entityTypeName, allKeyFieldSetPaths);
  if (configurations.length > 0) {
    return configurations;
  }
}

export function getConditionalFieldSetDirectiveName(isProvides: boolean): string {
  if (isProvides) {
    return PROVIDES;
  }
  return REQUIRES;
}

export function isNodeQuery(typeName: string, operationTypeNode?: OperationTypeNode): boolean {
  return typeName === QUERY || operationTypeNode === OperationTypeNode.QUERY;
}

export function validateArgumentTemplateReferences(
  value: string,
  argumentDataByArgumentName: Map<string, InputValueData>,
  errorMessages: string[],
) {
  const matches = value.matchAll(EDFS_ARGS_REGEXP);
  const undefinedArgs = new Set<string>();
  const invalidArgs = new Set<string>();
  for (const match of matches) {
    if (match.length < 2) {
      invalidArgs.add(match[0]);
      continue;
    }
    if (!argumentDataByArgumentName.has(match[1])) {
      undefinedArgs.add(match[1]);
    }
  }
  for (const undefinedArg of undefinedArgs) {
    errorMessages.push(undefinedEventSubjectsArgumentErrorMessage(undefinedArg));
  }
  for (const invalidArg of invalidArgs) {
    errorMessages.push(invalidEventSubjectsArgumentErrorMessage(invalidArg));
  }
}

export function initializeDirectiveDefinitionDatas(): Map<string, DirectiveDefinitionData> {
  return new Map<string, DirectiveDefinitionData>([
    [AUTHENTICATED, AUTHENTICATED_DEFINITION_DATA],
    [COMPOSE_DIRECTIVE, COMPOSE_DIRECTIVE_DEFINITION_DATA],
    [CONFIGURE_DESCRIPTION, CONFIGURE_DESCRIPTION_DEFINITION_DATA],
    [CONFIGURE_CHILD_DESCRIPTIONS, CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION_DATA],
    [DEPRECATED, DEPRECATED_DEFINITION_DATA],
    [EDFS_KAFKA_PUBLISH, KAFKA_PUBLISH_DEFINITION_DATA],
    [EDFS_KAFKA_SUBSCRIBE, KAFKA_SUBSCRIBE_DEFINITION_DATA],
    [EDFS_NATS_PUBLISH, NATS_PUBLISH_DEFINITION_DATA],
    [EDFS_NATS_REQUEST, NATS_REQUEST_DEFINITION_DATA],
    [EDFS_NATS_SUBSCRIBE, NATS_SUBSCRIBE_DEFINITION_DATA],
    [EDFS_REDIS_PUBLISH, REDIS_PUBLISH_DEFINITION_DATA],
    [EDFS_REDIS_SUBSCRIBE, REDIS_SUBSCRIBE_DEFINITION_DATA],
    [EXTENDS, EXTENDS_DEFINITION_DATA],
    [EXTERNAL, EXTERNAL_DEFINITION_DATA],
    [INACCESSIBLE, INACCESSIBLE_DEFINITION_DATA],
    [INTERFACE_OBJECT, INTERFACE_OBJECT_DEFINITION_DATA],
    [KEY, KEY_DEFINITION_DATA],
    [LINK, LINK_DEFINITION_DATA],
    [OVERRIDE, OVERRIDE_DEFINITION_DATA],
    [PROVIDES, PROVIDES_DEFINITION_DATA],
    [REQUIRE_FETCH_REASONS, REQUIRE_FETCH_REASONS_DEFINITION_DATA],
    [REQUIRES, REQUIRES_DEFINITION_DATA],
    [REQUIRES_SCOPES, REQUIRES_SCOPES_DEFINITION_DATA],
    [SHAREABLE, SHAREABLE_DEFINITION_DATA],
    [SPECIFIED_BY, SPECIFIED_BY_DEFINITION_DATA],
    [SUBSCRIPTION_FILTER, SUBSCRIPTION_FILTER_DEFINITION_DATA],
    [TAG, TAG_DEFINITION_DATA],
  ]);
}
