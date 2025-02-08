import { BREAK, ConstDirectiveNode, DocumentNode, Kind, OperationTypeNode, print, ValueNode, visit } from 'graphql';
import { getOrThrowError, getValueOrDefault, kindToTypeString } from '../utils/utils';
import { isKindAbstract, lexicographicallySortDocumentNode, safeParse } from '../../ast/utils';
import { NormalizationFactory } from './normalization-factory';
import {
  abstractTypeInKeyFieldSetErrorMessage,
  argumentsInKeyFieldSetErrorMessage,
  duplicateFieldInFieldSetErrorMessage,
  incompatibleTypeWithProvidesErrorMessage,
  inlineFragmentInFieldSetErrorMessage,
  inlineFragmentWithoutTypeConditionErrorMessage,
  invalidConfigurationDataErrorMessage,
  invalidConfigurationResultFatalError,
  invalidEventSubjectsArgumentErrorMessage,
  invalidInlineFragmentTypeConditionErrorMessage,
  invalidInlineFragmentTypeConditionTypeErrorMessage,
  invalidInlineFragmentTypeErrorMessage,
  invalidKeyDirectivesError,
  invalidProvidesOrRequiresDirectivesError,
  invalidSelectionOnUnionErrorMessage,
  invalidSelectionSetDefinitionErrorMessage,
  invalidSelectionSetErrorMessage,
  nonExternalConditionalFieldError,
  undefinedEventSubjectsArgumentErrorMessage,
  undefinedFieldInFieldSetErrorMessage,
  unexpectedArgumentErrorMessage,
  unknownInlineFragmentTypeConditionErrorMessage,
  unknownNamedTypeErrorMessage,
  unknownTypeInFieldSetErrorMessage,
  unparsableFieldSetErrorMessage,
  unparsableFieldSetSelectionErrorMessage,
} from '../../errors/errors';
import { BASE_SCALARS, EDFS_ARGS_REGEXP } from '../utils/constants';
import {
  ConfigurationData,
  newFieldSetConditionData,
  RequiredFieldConfiguration,
} from '../../router-configuration/router-configuration';
import {
  ArgumentData,
  CompositeOutputData,
  DirectiveDefinitionData,
  FieldData,
  InputValueData,
  NodeData,
  SchemaData,
  UnionDefinitionData,
} from '../../schema-building/types';
import { getTypeNodeNamedTypeName } from '../../schema-building/ast';
import { FieldSetDirective, getParentTypeName, newConditionalFieldData } from '../../schema-building/utils';
import { nonExternalConditionalFieldWarning } from '../warnings/warnings';
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
  REQUIRES,
  REQUIRES_SCOPES,
  SHAREABLE,
  SPECIFIED_BY,
  SUBSCRIPTION_FILTER,
  TAG,
} from '../../utils/string-constants';

export type KeyFieldSetData = {
  isUnresolvableByKeyFieldSet: Map<string, boolean>;
};

export function newKeyFieldSetData(): KeyFieldSetData {
  return {
    isUnresolvableByKeyFieldSet: new Map<string, boolean>(),
  };
}

export type FieldSetData = {
  provides: Map<string, string>;
  requires: Map<string, string>;
};

export function newFieldSetData(): FieldSetData {
  return {
    provides: new Map<string, string>(),
    requires: new Map<string, string>(),
  };
}

export type InputValidationContainer = {
  hasUnhandledError: boolean;
  typeString: string;
};

export function addFieldNamesToConfigurationData(
  fieldDataByFieldName: Map<string, FieldData>,
  configurationData: ConfigurationData,
) {
  const externalFieldNames = new Set<string>();
  for (const [fieldName, fieldContainer] of fieldDataByFieldName) {
    if (fieldContainer.directivesByDirectiveName.has(EXTERNAL)) {
      if (configurationData.externalFieldNames) {
        configurationData.externalFieldNames.add(fieldName);
      } else {
        externalFieldNames.add(fieldName);
      }
    } else {
      configurationData.fieldNames.add(fieldName);
    }
  }
  if (externalFieldNames.size > 0) {
    configurationData.externalFieldNames = externalFieldNames;
  }
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

type NonRepeatableFieldSetValidationResult = {
  errorMessage?: string;
  configuration?: RequiredFieldConfiguration;
};

export function getNormalizedFieldSet(documentNode: DocumentNode): string {
  /*
    1. Lexicographically sort the DocumentNode
    2. Convert to a string
    3. Replace consecutive whitespace with a single space
    4. Remove the leading and trailing "{ " and " }", respectively
  */
  return print(lexicographicallySortDocumentNode(documentNode)).replaceAll(/\s+/g, ' ').slice(2, -2);
}

function getInitialFieldCoordinatesPath(
  fieldSetDirective: FieldSetDirective,
  directiveParentTypeName: string,
  directiveFieldName: string,
): Array<string> {
  switch (fieldSetDirective) {
    case FieldSetDirective.PROVIDES:
      return [`${directiveParentTypeName}.${directiveFieldName}`];
    default:
      return [];
  }
}

function validateNonRepeatableFieldSet(
  nf: NormalizationFactory,
  selectionSetParentData: CompositeOutputData,
  fieldSet: string,
  directiveFieldName: string,
  fieldSetDirective: FieldSetDirective,
  directiveParentTypeName: string,
): NonRepeatableFieldSetValidationResult {
  // Create a new selection set so that the value can be parsed as a new DocumentNode
  const { error, documentNode } = safeParse('{' + fieldSet + '}');
  if (error || !documentNode) {
    return { errorMessage: unparsableFieldSetErrorMessage(fieldSet, error) };
  }
  const parentDatas: (CompositeOutputData | UnionDefinitionData)[] = [selectionSetParentData];
  const definedFields: Set<string>[] = [];
  const fieldCoordinatesPath = getInitialFieldCoordinatesPath(
    fieldSetDirective,
    directiveParentTypeName,
    directiveFieldName,
  );
  const fieldPath = [directiveFieldName];
  const externalAncestors = new Set<string>();
  let errorMessage;
  let currentDepth = -1;
  let shouldDefineSelectionSet = true;
  let lastFieldName = directiveFieldName;
  visit(documentNode, {
    Argument: {
      enter() {
        return false;
      },
    },
    Field: {
      enter(node) {
        const parentData = parentDatas[currentDepth];
        const parentTypeName = parentData.name;
        if (parentData.kind === Kind.UNION_TYPE_DEFINITION) {
          errorMessage = invalidSelectionOnUnionErrorMessage(fieldSet, fieldCoordinatesPath, parentTypeName);
          return BREAK;
        }
        const fieldName = node.name.value;
        const currentFieldCoords = `${parentTypeName}.${fieldName}`;
        nf.unvalidatedExternalFieldCoords.delete(currentFieldCoords);
        // If an object-like was just visited, a selection set should have been entered
        if (shouldDefineSelectionSet) {
          errorMessage = invalidSelectionSetErrorMessage(
            fieldSet,
            fieldCoordinatesPath,
            parentTypeName,
            kindToTypeString(parentData.kind),
          );
          return BREAK;
        }
        fieldCoordinatesPath.push(currentFieldCoords);
        fieldPath.push(fieldName);
        lastFieldName = fieldName;
        const fieldData = parentData.fieldDataByFieldName.get(fieldName);
        // undefined if the field does not exist on the parent
        if (!fieldData) {
          errorMessage = undefinedFieldInFieldSetErrorMessage(fieldSet, parentTypeName, fieldName);
          return BREAK;
        }
        if (definedFields[currentDepth].has(fieldName)) {
          errorMessage = duplicateFieldInFieldSetErrorMessage(fieldSet, currentFieldCoords);
          return BREAK;
        }
        definedFields[currentDepth].add(fieldName);
        const isExternal = fieldData.isExternalBySubgraphName.get(nf.subgraphName);
        const namedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
        // The child could itself be a parent
        const namedTypeData = nf.parentDefinitionDataByTypeName.get(namedTypeName);
        // The base scalars are not in the parents map
        if (
          BASE_SCALARS.has(namedTypeName) ||
          namedTypeData?.kind === Kind.SCALAR_TYPE_DEFINITION ||
          namedTypeData?.kind === Kind.ENUM_TYPE_DEFINITION
        ) {
          if (externalAncestors.size < 1 && !isExternal) {
            if (nf.isSubgraphVersionTwo) {
              nf.errors.push(
                nonExternalConditionalFieldError(
                  `${directiveParentTypeName}.${directiveFieldName}`,
                  nf.subgraphName,
                  currentFieldCoords,
                  fieldSet,
                  fieldSetDirective,
                ),
              );
            } else {
              /* In V1, @requires and @provides do not need to declare any part of the field set @external.
               * It would appear that any such non-external fields are treated as if they are non-conditionally provided.
               * */
              nf.warnings.push(
                nonExternalConditionalFieldWarning(
                  `${directiveParentTypeName}.${directiveFieldName}`,
                  nf.subgraphName,
                  currentFieldCoords,
                  fieldSet,
                  fieldSetDirective,
                ),
              );
            }
            return;
          }
          const conditionalFieldData = getValueOrDefault(
            nf.conditionalFieldDataByCoordinates,
            currentFieldCoords,
            newConditionalFieldData,
          );
          const fieldSetCondition = newFieldSetConditionData({
            fieldCoordinatesPath: [...fieldCoordinatesPath],
            fieldPath: [...fieldPath],
          });
          fieldSetDirective === FieldSetDirective.PROVIDES
            ? conditionalFieldData.providedBy.push(fieldSetCondition)
            : conditionalFieldData.requiredBy.push(fieldSetCondition);
          return;
        }
        if (!namedTypeData) {
          // Should not be possible to receive this error
          errorMessage = unknownTypeInFieldSetErrorMessage(fieldSet, currentFieldCoords, namedTypeName);
          return BREAK;
        }
        if (isExternal) {
          const data = getValueOrDefault(
            nf.conditionalFieldDataByCoordinates,
            currentFieldCoords,
            newConditionalFieldData,
          );
          switch (fieldSetDirective) {
            case FieldSetDirective.PROVIDES:
              data.providedBy.push(
                newFieldSetConditionData({
                  fieldCoordinatesPath: [...fieldCoordinatesPath],
                  fieldPath: [...fieldPath],
                }),
              );
              break;
            default:
              break;
          }
          externalAncestors.add(currentFieldCoords);
        }
        if (
          namedTypeData.kind === Kind.OBJECT_TYPE_DEFINITION ||
          namedTypeData.kind === Kind.INTERFACE_TYPE_DEFINITION ||
          namedTypeData.kind === Kind.UNION_TYPE_DEFINITION
        ) {
          shouldDefineSelectionSet = true;
          parentDatas.push(namedTypeData);
          return;
        }
      },
      leave() {
        externalAncestors.delete(fieldCoordinatesPath.pop() || '');
        fieldPath.pop();
      },
    },
    InlineFragment: {
      enter(node) {
        const parentData = parentDatas[currentDepth];
        const parentTypeName = parentData.name;
        const fieldCoordinates =
          fieldCoordinatesPath.length < 1
            ? selectionSetParentData.name
            : fieldCoordinatesPath[fieldCoordinatesPath.length - 1];
        if (!node.typeCondition) {
          errorMessage = inlineFragmentWithoutTypeConditionErrorMessage(fieldSet, fieldCoordinates);
          return BREAK;
        }
        const typeConditionName = node.typeCondition.name.value;
        // It's possible to infinitely define fragments
        if (typeConditionName === parentTypeName) {
          parentDatas.push(parentData);
          shouldDefineSelectionSet = true;
          return;
        }
        if (!isKindAbstract(parentData.kind)) {
          errorMessage = invalidInlineFragmentTypeErrorMessage(
            fieldSet,
            fieldCoordinatesPath,
            typeConditionName,
            parentTypeName,
          );
          return BREAK;
        }
        const fragmentNamedTypeData = nf.parentDefinitionDataByTypeName.get(typeConditionName);
        if (!fragmentNamedTypeData) {
          errorMessage = unknownInlineFragmentTypeConditionErrorMessage(
            fieldSet,
            fieldCoordinatesPath,
            parentTypeName,
            typeConditionName,
          );
          return BREAK;
        }
        shouldDefineSelectionSet = true;
        switch (fragmentNamedTypeData.kind) {
          case Kind.INTERFACE_TYPE_DEFINITION: {
            if (!fragmentNamedTypeData.implementedInterfaceTypeNames.has(parentTypeName)) {
              break;
            }
            parentDatas.push(fragmentNamedTypeData);
            return;
          }
          case Kind.OBJECT_TYPE_DEFINITION: {
            const concreteTypeNames = nf.concreteTypeNamesByAbstractTypeName.get(parentTypeName);
            if (!concreteTypeNames || !concreteTypeNames.has(typeConditionName)) {
              break;
            }
            parentDatas.push(fragmentNamedTypeData);
            return;
          }
          case Kind.UNION_TYPE_DEFINITION: {
            parentDatas.push(fragmentNamedTypeData);
            return;
          }
          default: {
            errorMessage = invalidInlineFragmentTypeConditionTypeErrorMessage(
              fieldSet,
              fieldCoordinatesPath,
              parentTypeName,
              typeConditionName,
              kindToTypeString(fragmentNamedTypeData.kind),
            );
            return BREAK;
          }
        }
        errorMessage = invalidInlineFragmentTypeConditionErrorMessage(
          fieldSet,
          fieldCoordinatesPath,
          typeConditionName,
          kindToTypeString(parentData.kind),
          parentTypeName,
        );
        return BREAK;
      },
    },
    SelectionSet: {
      enter() {
        if (!shouldDefineSelectionSet) {
          const parentData = parentDatas[currentDepth];
          if (parentData.kind === Kind.UNION_TYPE_DEFINITION) {
            // Should never happen
            errorMessage = unparsableFieldSetSelectionErrorMessage(fieldSet, lastFieldName);
            return BREAK;
          }
          const fieldData = parentData.fieldDataByFieldName.get(lastFieldName);
          if (!fieldData) {
            errorMessage = undefinedFieldInFieldSetErrorMessage(fieldSet, parentData.name, lastFieldName);
            return BREAK;
          }
          const fieldNamedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
          // If the child is not found, it's a base scalar. Undefined types would have already been handled.
          const namedTypeData = nf.parentDefinitionDataByTypeName.get(fieldNamedTypeName);
          const childKind = namedTypeData ? namedTypeData.kind : Kind.SCALAR_TYPE_DEFINITION;
          errorMessage = invalidSelectionSetDefinitionErrorMessage(
            fieldSet,
            fieldCoordinatesPath,
            fieldNamedTypeName,
            kindToTypeString(childKind),
          );
          return BREAK;
        }
        currentDepth += 1;
        shouldDefineSelectionSet = false;
        if (currentDepth < 0 || currentDepth >= parentDatas.length) {
          errorMessage = unparsableFieldSetSelectionErrorMessage(fieldSet, lastFieldName);
          return BREAK;
        }
        definedFields.push(new Set<string>());
      },
      leave() {
        if (shouldDefineSelectionSet) {
          const parentData = parentDatas[currentDepth + 1];
          errorMessage = invalidSelectionSetErrorMessage(
            fieldSet,
            fieldCoordinatesPath,
            parentData.name,
            kindToTypeString(parentData.kind),
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
  if (errorMessage) {
    return { errorMessage };
  }
  return { configuration: { fieldName: directiveFieldName, selectionSet: getNormalizedFieldSet(documentNode) } };
}

export function validateKeyFieldSets(
  nf: NormalizationFactory,
  entityParentData: CompositeOutputData,
  nonResolvableByKeyFieldSet: Map<string, boolean>,
  fieldNames: Set<string>,
): RequiredFieldConfiguration[] | undefined {
  const isEntityInterface = nf.entityInterfaceDataByTypeName.has(entityParentData.name);
  const entityTypeName = entityParentData.name;
  const errorMessages: string[] = [];
  const configurations: RequiredFieldConfiguration[] = [];
  const keyFieldNames = new Set<string>();
  const allKeyFieldSetPaths: Array<Set<string>> = [];
  // If the key is on an entity interface/interface object, an entity data node should not be propagated
  const entityDataNode = isEntityInterface ? undefined : nf.internalGraph.addEntityDataNode(entityParentData.name);
  const graphNode = nf.internalGraph.addOrUpdateNode(entityParentData.name);
  for (const [fieldSet, disableEntityResolver] of nonResolvableByKeyFieldSet) {
    // Create a new selection set so that the value can be parsed as a new DocumentNode
    const { error, documentNode } = safeParse('{' + fieldSet + '}');
    if (error || !documentNode) {
      errorMessages.push(unparsableFieldSetErrorMessage(fieldSet, error));
      continue;
    }
    const parentWithFieldsDatas: CompositeOutputData[] = [entityParentData];
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
              fieldSet,
              `${parentWithFieldsDatas[currentDepth].name}.${lastFieldName}`,
              node.name.value,
            ),
          );
          return BREAK;
        },
      },
      Field: {
        enter(node) {
          const grandparentData = parentWithFieldsDatas[currentDepth - 1];
          const parentData = parentWithFieldsDatas[currentDepth];
          const parentTypeName = parentData.name;
          const fieldName = node.name.value;
          const fieldCoords = `${parentTypeName}.${fieldName}`;
          nf.unvalidatedExternalFieldCoords.delete(fieldCoords);
          // If an object-like was just visited, a selection set should have been entered
          if (shouldDefineSelectionSet) {
            errorMessages.push(
              invalidSelectionSetErrorMessage(
                fieldSet,
                [`${grandparentData.name}.${lastFieldName}`],
                parentTypeName,
                kindToTypeString(parentData.kind),
              ),
            );
            return BREAK;
          }
          lastFieldName = fieldName;
          const fieldData = parentData.fieldDataByFieldName.get(fieldName);
          // undefined if the field does not exist on the parent
          if (!fieldData) {
            errorMessages.push(undefinedFieldInFieldSetErrorMessage(fieldSet, parentTypeName, fieldName));
            return BREAK;
          }
          // TODO navigate already provided keys
          if (fieldData.argumentDataByArgumentName.size) {
            errorMessages.push(argumentsInKeyFieldSetErrorMessage(fieldSet, fieldCoords));
            return BREAK;
          }
          if (definedFields[currentDepth].has(fieldName)) {
            errorMessages.push(duplicateFieldInFieldSetErrorMessage(fieldSet, fieldCoords));
            return BREAK;
          }
          currentPath.push(fieldName);
          // Fields that form part of an entity key are intrinsically shareable
          fieldData.isShareableBySubgraphName.set(nf.subgraphName, true);
          definedFields[currentDepth].add(fieldName);
          /* Depth 0 is the original parent type
           * If a field is external, but it's part of a key FieldSet, it should be included in its respective
           * root or child node */
          if (currentDepth === 0) {
            keyFieldNames.add(fieldName);
            fieldNames.add(fieldName);
          } else {
            const nestedConfigurationData = nf.configurationDataByParentTypeName.get(parentTypeName);
            if (!nestedConfigurationData) {
              errorMessages.push(invalidConfigurationDataErrorMessage(parentTypeName, fieldName, fieldSet));
              return BREAK;
            }
            nestedConfigurationData.fieldNames.add(fieldName);
          }
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
            errorMessages.push(unknownTypeInFieldSetErrorMessage(fieldSet, fieldCoords, namedTypeName));
            return BREAK;
          }
          if (namedTypeData.kind === Kind.OBJECT_TYPE_DEFINITION) {
            shouldDefineSelectionSet = true;
            parentWithFieldsDatas.push(namedTypeData);
            return;
          }
          // interfaces and unions are invalid in a key directive
          if (isKindAbstract(namedTypeData.kind)) {
            errorMessages.push(
              abstractTypeInKeyFieldSetErrorMessage(
                fieldSet,
                fieldCoords,
                namedTypeName,
                kindToTypeString(namedTypeData.kind),
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
            const parentData = parentWithFieldsDatas[currentDepth];
            const parentTypeName = parentData.name;
            const fieldCoordinates = `${parentTypeName}.${lastFieldName}`;
            // If the last field is not an object-like
            const fieldData = parentData.fieldDataByFieldName.get(lastFieldName);
            if (!fieldData) {
              errorMessages.push(undefinedFieldInFieldSetErrorMessage(fieldSet, fieldCoordinates, lastFieldName));
              return BREAK;
            }
            const fieldNamedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
            // If the child is not found, it's a base scalar. Undefined types would have already been handled.
            const namedTypeData = nf.parentDefinitionDataByTypeName.get(fieldNamedTypeName);
            const namedTypeKind = namedTypeData ? namedTypeData.kind : Kind.SCALAR_TYPE_DEFINITION;
            errorMessages.push(
              invalidSelectionSetDefinitionErrorMessage(
                fieldSet,
                [fieldCoordinates],
                fieldNamedTypeName,
                kindToTypeString(namedTypeKind),
              ),
            );
            return BREAK;
          }
          currentDepth += 1;
          shouldDefineSelectionSet = false;
          if (currentDepth < 0 || currentDepth >= parentWithFieldsDatas.length) {
            errorMessages.push(unparsableFieldSetSelectionErrorMessage(fieldSet, lastFieldName));
            return BREAK;
          }
          definedFields.push(new Set<string>());
        },
        leave() {
          if (shouldDefineSelectionSet) {
            const grandparentData = parentWithFieldsDatas[currentDepth];
            const grandparentTypeName = grandparentData.name;
            const parentData = parentWithFieldsDatas[currentDepth + 1];
            const fieldCoordinates = `${grandparentTypeName}.${lastFieldName}`;
            errorMessages.push(
              invalidSelectionSetErrorMessage(
                fieldSet,
                [fieldCoordinates],
                parentData.name,
                kindToTypeString(parentData.kind),
              ),
            );
            shouldDefineSelectionSet = false;
          }
          // Empty selection sets would be a parse error, so it is unnecessary to handle them
          currentDepth -= 1;
          parentWithFieldsDatas.pop();
          definedFields.pop();
        },
      },
    });
    if (errorMessages.length > 0) {
      continue;
    }
    const normalizedFieldSet = getNormalizedFieldSet(documentNode);
    configurations.push({
      fieldName: '',
      selectionSet: normalizedFieldSet,
      ...(disableEntityResolver ? { disableEntityResolver: true } : {}),
    });
    graphNode.satisfiedFieldSets.add(normalizedFieldSet);
    if (disableEntityResolver) {
      continue;
    }
    entityDataNode?.addTargetSubgraphByFieldSet(normalizedFieldSet, nf.subgraphName);
    allKeyFieldSetPaths.push(keyFieldSetPaths);
  }
  if (errorMessages.length) {
    nf.errors.push(invalidKeyDirectivesError(entityTypeName, errorMessages));
    return;
  }
  // todo
  // nf.internalGraph.addEntityNode(entityTypeName, allKeyFieldSetPaths);
  if (configurations.length) {
    return configurations;
  }
}

type FieldSetParentResult = {
  errorString?: string;
  fieldSetParentData?: CompositeOutputData;
};

function getFieldSetParent(
  factory: NormalizationFactory,
  fieldSetDirective: FieldSetDirective,
  parentData: CompositeOutputData,
  fieldName: string,
  parentTypeName: string,
): FieldSetParentResult {
  if (fieldSetDirective !== FieldSetDirective.PROVIDES) {
    return { fieldSetParentData: parentData };
  }
  const fieldData = getOrThrowError(
    parentData.fieldDataByFieldName,
    fieldName,
    `${parentTypeName}.fieldDataByFieldName`,
  );
  const fieldNamedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);

  const namedTypeData = factory.parentDefinitionDataByTypeName.get(fieldNamedTypeName);
  // This error should never happen
  if (!namedTypeData) {
    return {
      errorString: unknownNamedTypeErrorMessage(`${parentTypeName}.${fieldName}`, fieldNamedTypeName),
    };
  }
  if (namedTypeData.kind !== Kind.INTERFACE_TYPE_DEFINITION && namedTypeData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
    return {
      errorString: incompatibleTypeWithProvidesErrorMessage(`${parentTypeName}.${fieldName}`, fieldNamedTypeName),
    };
  }
  return { fieldSetParentData: namedTypeData };
}

function validateProvidesOrRequires(
  nf: NormalizationFactory,
  parentData: CompositeOutputData,
  fieldSetByFieldName: Map<string, string>,
  fieldSetDirective: FieldSetDirective,
): RequiredFieldConfiguration[] | undefined {
  const errorMessages: string[] = [];
  const configurations: RequiredFieldConfiguration[] = [];
  const parentTypeName = getParentTypeName(parentData);
  for (const [fieldName, fieldSet] of fieldSetByFieldName) {
    /* It is possible to encounter a field before encountering the type definition.
     Consequently, at that time, it is unknown whether the named type is an entity.
     If it isn't, the @provides directive does not make sense and can be ignored.
    */
    const { fieldSetParentData, errorString } = getFieldSetParent(
      nf,
      fieldSetDirective,
      parentData,
      fieldName,
      parentTypeName,
    );
    const fieldCoords = `${parentTypeName}.${fieldName}`;
    if (errorString) {
      errorMessages.push(errorString);
      continue;
    }
    if (!fieldSetParentData) {
      continue;
    }
    const { errorMessage, configuration } = validateNonRepeatableFieldSet(
      nf,
      fieldSetParentData,
      fieldSet,
      fieldName,
      fieldSetDirective,
      parentTypeName,
    );
    if (errorMessage) {
      errorMessages.push(` On "${fieldCoords}" —` + errorMessage);
      continue;
    }
    if (configuration) {
      configurations.push(configuration);
      continue;
    }
    // Should never happen
    throw invalidConfigurationResultFatalError(fieldCoords);
  }
  if (errorMessages.length > 0) {
    nf.errors.push(invalidProvidesOrRequiresDirectivesError(fieldSetDirective, errorMessages));
    return;
  }
  if (configurations.length > 0) {
    return configurations;
  }
}

export function validateAndAddConditionalFieldSetsToConfiguration(
  nf: NormalizationFactory,
  parentData: CompositeOutputData,
  fieldSetData: FieldSetData,
) {
  const configurationData = getOrThrowError(
    nf.configurationDataByParentTypeName,
    getParentTypeName(parentData),
    'configurationDataByParentTypeName',
  );
  const provides = validateProvidesOrRequires(nf, parentData, fieldSetData.provides, FieldSetDirective.PROVIDES);
  if (provides) {
    configurationData.provides = provides;
  }
  const requires = validateProvidesOrRequires(nf, parentData, fieldSetData.requires, FieldSetDirective.REQUIRES);
  if (requires) {
    configurationData.requires = requires;
  }
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
    [EXTENDS, EXTENDS_DEFINITION_DATA],
    [EXTERNAL, EXTERNAL_DEFINITION_DATA],
    [INACCESSIBLE, INACCESSIBLE_DEFINITION_DATA],
    [INTERFACE_OBJECT, INTERFACE_OBJECT_DEFINITION_DATA],
    [KEY, KEY_DEFINITION_DATA],
    [LINK, LINK_DEFINITION_DATA],
    [OVERRIDE, OVERRIDE_DEFINITION_DATA],
    [PROVIDES, PROVIDES_DEFINITION_DATA],
    [REQUIRES, REQUIRES_DEFINITION_DATA],
    [REQUIRES_SCOPES, REQUIRES_SCOPES_DEFINITION_DATA],
    [SHAREABLE, SHAREABLE_DEFINITION_DATA],
    [SPECIFIED_BY, SPECIFIED_BY_DEFINITION_DATA],
    [SUBSCRIPTION_FILTER, SUBSCRIPTION_FILTER_DEFINITION_DATA],
    [TAG, TAG_DEFINITION_DATA],
  ]);
}

export type ExtractArgumentDataResult = {
  argumentTypeNodeByArgumentName: Map<string, ArgumentData>;
  optionalArgumentNames: Set<string>;
  requiredArgumentNames: Set<string>;
};

export type ValidateDirectiveParams = {
  data: NodeData | SchemaData;
  definitionData: DirectiveDefinitionData;
  directiveCoords: string;
  directiveNode: ConstDirectiveNode;
  errorMessages: Array<string>;
  requiredArgumentNames: Array<string>;
};

export type HandleOverrideDirectiveParams = {
  data: FieldData;
  directiveCoords: string;
  errorMessages: Array<string>;
  targetSubgraphName: string;
};

export type HandleRequiresScopesDirectiveParams = {
  directiveCoords: string;
  orScopes: ReadonlyArray<ValueNode>;
  requiredScopes: Array<Set<string>>;
};
