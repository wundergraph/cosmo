import {
  BREAK,
  ConstDirectiveNode,
  DirectiveDefinitionNode,
  DocumentNode,
  InputValueDefinitionNode,
  Kind,
  OperationTypeNode,
  print,
  TypeNode,
  visit,
} from 'graphql';
import { getOrThrowError, getValueOrDefault, kindToTypeString } from '../utils/utils';
import { isKindAbstract, lexicographicallySortDocumentNode, safeParse } from '../ast/utils';
import {
  ARGUMENT_DEFINITION_UPPER,
  ENUM_UPPER,
  ENUM_VALUE_UPPER,
  EXTERNAL,
  FIELD_DEFINITION_UPPER,
  FIELD_UPPER,
  FIELDS,
  FRAGMENT_DEFINITION_UPPER,
  FRAGMENT_SPREAD_UPPER,
  INLINE_FRAGMENT_UPPER,
  INPUT_FIELD_DEFINITION_UPPER,
  INPUT_OBJECT_UPPER,
  INTERFACE_UPPER,
  MUTATION_UPPER,
  OBJECT_UPPER,
  QUERY,
  QUERY_UPPER,
  SCALAR_UPPER,
  SCHEMA_UPPER,
  SUBSCRIPTION_UPPER,
  UNION_UPPER,
  VARIABLE_DEFINITION_UPPER,
} from '../utils/string-constants';
import { NormalizationFactory } from './normalization-factory';
import { getNamedTypeForChild } from '../schema-building/type-merging';
import {
  abstractTypeInKeyFieldSetErrorMessage,
  argumentsInKeyFieldSetErrorMessage,
  duplicateFieldInFieldSetErrorMessage,
  inlineFragmentInFieldSetErrorMessage,
  inlineFragmentWithoutTypeConditionErrorMessage,
  invalidConfigurationResultFatalError,
  invalidInlineFragmentTypeConditionErrorMessage,
  invalidInlineFragmentTypeConditionTypeErrorMessage,
  invalidInlineFragmentTypeErrorMessage,
  invalidKeyDirectivesError,
  invalidProvidesOrRequiresDirectivesError,
  invalidSelectionOnUnionErrorMessage,
  invalidSelectionSetDefinitionErrorMessage,
  invalidSelectionSetErrorMessage,
  undefinedFieldInFieldSetErrorMessage,
  unexpectedArgumentErrorMessage,
  unexpectedDirectiveLocationError,
  unknownInlineFragmentTypeConditionErrorMessage,
  unknownProvidesEntityErrorMessage,
  unknownTypeInFieldSetErrorMessage,
  unparsableFieldSetErrorMessage,
  unparsableFieldSetSelectionErrorMessage,
} from '../errors/errors';
import { BASE_SCALARS } from '../utils/constants';
import { RequiredFieldConfiguration } from '../router-configuration/router-configuration';
import { FieldData, ParentWithFieldsData, UnionDefinitionData } from '../schema-building/type-definition-data';

export type FieldSetContainer = {
  keys: Set<string>;
  provides: Map<string, string>;
  requires: Map<string, string>;
  disableEntityResolver?: boolean;
};

export function newFieldSetContainer(): FieldSetContainer {
  return {
    keys: new Set<string>(),
    provides: new Map<string, string>(),
    requires: new Map<string, string>(),
  };
}

export function areNodeKindAndDirectiveLocationCompatible(
  kind: Kind,
  directiveDefinitionNode: DirectiveDefinitionNode,
  isArgument = false,
): boolean {
  for (const location of directiveDefinitionNode.locations) {
    const locationName = location.value.toUpperCase();
    switch (locationName) {
      case ARGUMENT_DEFINITION_UPPER:
        if (!isArgument) {
          break;
        }
        if (kind === Kind.INPUT_VALUE_DEFINITION) {
          return true;
        }
        break;
      case ENUM_UPPER:
        if (kind === Kind.ENUM_TYPE_DEFINITION || kind === Kind.ENUM_TYPE_EXTENSION) {
          return true;
        }
        break;
      case ENUM_VALUE_UPPER:
        if (kind === Kind.ENUM_VALUE_DEFINITION) {
          return true;
        }
        break;
      case FIELD_UPPER:
        if (kind === Kind.FIELD) {
          return true;
        }
        break;
      case FIELD_DEFINITION_UPPER:
        if (kind === Kind.FIELD_DEFINITION) {
          return true;
        }
        break;
      case INLINE_FRAGMENT_UPPER:
        if (kind === Kind.INLINE_FRAGMENT) {
          return true;
        }
        break;
      case INPUT_FIELD_DEFINITION_UPPER:
        if (kind === Kind.INPUT_VALUE_DEFINITION) {
          return true;
        }
        break;
      case INPUT_OBJECT_UPPER:
        if (kind === Kind.INPUT_OBJECT_TYPE_DEFINITION || kind === Kind.INPUT_OBJECT_TYPE_EXTENSION) {
          return true;
        }
        break;
      case INTERFACE_UPPER:
        if (kind === Kind.INTERFACE_TYPE_DEFINITION || kind === Kind.INTERFACE_TYPE_EXTENSION) {
          return true;
        }
        break;
      case OBJECT_UPPER:
        if (kind === Kind.OBJECT_TYPE_DEFINITION || kind === Kind.OBJECT_TYPE_EXTENSION) {
          return true;
        }
        break;
      case FRAGMENT_DEFINITION_UPPER:
        if (kind === Kind.FRAGMENT_DEFINITION) {
          return true;
        }
        break;
      case FRAGMENT_SPREAD_UPPER:
        if (kind === Kind.FRAGMENT_SPREAD) {
          return true;
        }
        break;
      case SCALAR_UPPER:
        if (kind === Kind.SCALAR_TYPE_DEFINITION || kind === Kind.SCALAR_TYPE_EXTENSION) {
          return true;
        }
        break;
      case SCHEMA_UPPER:
        if (kind === Kind.SCHEMA_DEFINITION || kind === Kind.SCHEMA_EXTENSION) {
          return true;
        }
        break;
      case UNION_UPPER:
        if (kind === Kind.UNION_TYPE_DEFINITION || kind === Kind.UNION_TYPE_EXTENSION) {
          return true;
        }
        break;
      case VARIABLE_DEFINITION_UPPER:
        if (kind === Kind.VARIABLE_DEFINITION) {
          return true;
        }
        break;
      case QUERY_UPPER:
      // intentional fallthrough
      case MUTATION_UPPER:
      // intentional fallthrough
      case SUBSCRIPTION_UPPER:
        if (kind === Kind.OPERATION_DEFINITION) {
          return true;
        }
        break;
      default:
        throw unexpectedDirectiveLocationError(locationName);
    }
  }
  return false;
}

export function getDirectiveDefinitionArgumentSets(
  args: readonly InputValueDefinitionNode[],
  argumentKindByArgumentName: Map<string, TypeNode>,
  requiredArguments: Set<string>,
) {
  for (const argument of args) {
    const argumentName = argument.name.value;
    argumentKindByArgumentName.set(argumentName, argument.type);
    // If the definition defines a default argument, it's not necessary to include it
    if (argument.type.kind === Kind.NON_NULL_TYPE && !argument.defaultValue) {
      requiredArguments.add(argumentName);
    }
  }
}

export type InputValidationContainer = {
  hasUnhandledError: boolean;
  typeString: string;
};

export function addNonExternalFieldsToSet(fieldDataByFieldName: Map<string, FieldData>, fieldNames: Set<string>) {
  for (const [fieldName, fieldContainer] of fieldDataByFieldName) {
    if (fieldContainer.directivesByDirectiveName.has(EXTERNAL)) {
      continue;
    }
    fieldNames.add(fieldName);
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

function validateNonRepeatableFieldSet(
  factory: NormalizationFactory,
  parentData: ParentWithFieldsData,
  fieldSet: string,
  directiveFieldName: string,
): NonRepeatableFieldSetValidationResult {
  // Create a new selection set so that the value can be parsed as a new DocumentNode
  const { error, documentNode } = safeParse('{' + fieldSet + '}');
  if (error || !documentNode) {
    return { errorMessage: unparsableFieldSetErrorMessage(fieldSet, error) };
  }
  let errorMessage;
  const parentDatas: (ParentWithFieldsData | UnionDefinitionData)[] = [parentData];
  const definedFields: Set<string>[] = [];
  let currentDepth = -1;
  let shouldDefineSelectionSet = true;
  let lastFieldName = directiveFieldName;
  let fieldPath = parentData.typeName;
  visit(documentNode, {
    Argument: {
      enter() {
        return false;
      },
    },
    Field: {
      enter(node) {
        const parentData = parentDatas[currentDepth];
        const parentTypeName = parentData.typeName;
        if (parentData.kind === Kind.UNION_TYPE_DEFINITION) {
          errorMessage = invalidSelectionOnUnionErrorMessage(fieldSet, fieldPath, parentTypeName);
          return BREAK;
        }
        // If an object-like was just visited, a selection set should have been entered
        if (shouldDefineSelectionSet) {
          errorMessage = invalidSelectionSetErrorMessage(
            fieldSet,
            fieldPath,
            parentTypeName,
            kindToTypeString(parentData.kind),
          );
          return BREAK;
        }
        const fieldName = node.name.value;
        fieldPath = `${parentTypeName}.${fieldName}`;
        lastFieldName = fieldName;
        const fieldContainer = parentData.fieldDataByFieldName.get(fieldName);
        // undefined if the field does not exist on the parent
        if (!fieldContainer) {
          errorMessage = undefinedFieldInFieldSetErrorMessage(fieldSet, parentTypeName, fieldName);
          return BREAK;
        }
        if (definedFields[currentDepth].has(fieldName)) {
          errorMessage = duplicateFieldInFieldSetErrorMessage(fieldSet, fieldPath);
          return BREAK;
        }
        definedFields[currentDepth].add(fieldName);
        const namedTypeName = getNamedTypeForChild(fieldPath, fieldContainer.node.type);
        // The base scalars are not in the parents map
        if (BASE_SCALARS.has(namedTypeName)) {
          return;
        }
        // The child could itself be a parent and could exist as an object extension
        const childContainer =
          factory.parentDefinitionDataByTypeName.get(namedTypeName) ||
          factory.parentExtensionDataByTypeName.get(namedTypeName);
        if (!childContainer) {
          // Should not be possible to receive this error
          errorMessage = unknownTypeInFieldSetErrorMessage(fieldSet, fieldPath, namedTypeName);
          return BREAK;
        }
        if (
          childContainer.kind === Kind.OBJECT_TYPE_DEFINITION ||
          childContainer.kind === Kind.OBJECT_TYPE_EXTENSION ||
          childContainer.kind === Kind.INTERFACE_TYPE_DEFINITION ||
          childContainer.kind === Kind.UNION_TYPE_DEFINITION
        ) {
          shouldDefineSelectionSet = true;
          parentDatas.push(childContainer);
          return;
        }
      },
    },
    InlineFragment: {
      enter(node) {
        const parentData = parentDatas[currentDepth];
        const parentTypeName = parentData.typeName;
        if (!node.typeCondition) {
          errorMessage = inlineFragmentWithoutTypeConditionErrorMessage(fieldSet, fieldPath);
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
          errorMessage = invalidInlineFragmentTypeErrorMessage(fieldSet, fieldPath, typeConditionName, parentTypeName);
          return BREAK;
        }
        const fragmentTypeContainer =
          factory.parentDefinitionDataByTypeName.get(typeConditionName) ||
          factory.parentExtensionDataByTypeName.get(typeConditionName);
        if (!fragmentTypeContainer) {
          errorMessage = unknownInlineFragmentTypeConditionErrorMessage(fieldSet, fieldPath, typeConditionName);
          return BREAK;
        }
        if (
          fragmentTypeContainer.kind !== Kind.INTERFACE_TYPE_DEFINITION &&
          fragmentTypeContainer.kind !== Kind.OBJECT_TYPE_DEFINITION &&
          fragmentTypeContainer.kind !== Kind.OBJECT_TYPE_EXTENSION &&
          fragmentTypeContainer.kind !== Kind.UNION_TYPE_DEFINITION
        ) {
          errorMessage = invalidInlineFragmentTypeConditionTypeErrorMessage(
            fieldSet,
            fieldPath,
            typeConditionName,
            kindToTypeString(fragmentTypeContainer.kind),
          );
          return BREAK;
        }
        const concreteTypeNames = factory.abstractToConcreteTypeNames.get(parentTypeName);
        if (!concreteTypeNames || !concreteTypeNames.has(typeConditionName)) {
          errorMessage = invalidInlineFragmentTypeConditionErrorMessage(
            fieldSet,
            fieldPath,
            typeConditionName,
            kindToTypeString(parentData.kind),
            parentTypeName,
          );
          return BREAK;
        }
        shouldDefineSelectionSet = true;
        parentDatas.push(fragmentTypeContainer);
      },
      leave() {
        parentDatas.pop();
      },
    },
    SelectionSet: {
      enter() {
        if (!shouldDefineSelectionSet) {
          const parentContainer = parentDatas[currentDepth];
          if (parentContainer.kind === Kind.UNION_TYPE_DEFINITION) {
            // Should never happen
            errorMessage = unparsableFieldSetSelectionErrorMessage(fieldSet, lastFieldName);
            return BREAK;
          }
          const fieldContainer = parentContainer.fieldDataByFieldName.get(lastFieldName);
          if (!fieldContainer) {
            errorMessage = undefinedFieldInFieldSetErrorMessage(fieldSet, fieldPath, lastFieldName);
            return BREAK;
          }
          const fieldNamedTypeName = getNamedTypeForChild(fieldPath, fieldContainer.node.type);
          // If the child is not found, it's a base scalar. Undefined types would have already been handled.
          const childContainer = factory.parentDefinitionDataByTypeName.get(fieldNamedTypeName);
          const childKind = childContainer ? childContainer.kind : Kind.SCALAR_TYPE_DEFINITION;
          errorMessage = invalidSelectionSetDefinitionErrorMessage(
            fieldSet,
            fieldPath,
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
          const parentContainer = parentDatas[currentDepth + 1];
          errorMessage = invalidSelectionSetErrorMessage(
            fieldSet,
            fieldPath,
            parentContainer.typeName,
            kindToTypeString(parentContainer.kind),
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

function validateKeyFieldSets(
  factory: NormalizationFactory,
  entityParentData: ParentWithFieldsData,
  fieldSets: Set<string>,
  fieldNames: Set<string>,
  disableEntityResolver?: boolean,
): RequiredFieldConfiguration[] | undefined {
  const entityTypeName = entityParentData.typeName;
  const errorMessages: string[] = [];
  const configurations: RequiredFieldConfiguration[] = [];
  const keyFieldNames = new Set<string>();
  for (const fieldSet of fieldSets) {
    // Create a new selection set so that the value can be parsed as a new DocumentNode
    const { error, documentNode } = safeParse('{' + fieldSet + '}');
    if (error || !documentNode) {
      errorMessages.push(unparsableFieldSetErrorMessage(fieldSet, error));
      continue;
    }
    const parentWithFieldsDatas: ParentWithFieldsData[] = [entityParentData];
    const definedFields: Set<string>[] = [];
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
              `${parentWithFieldsDatas[currentDepth].typeName}.${lastFieldName}`,
              node.name.value,
            ),
          );
          return BREAK;
        },
      },
      Field: {
        enter(node) {
          const grandparentContainer = parentWithFieldsDatas[currentDepth - 1];
          const parentData = parentWithFieldsDatas[currentDepth];
          const parentTypeName = parentData.typeName;
          // If an object-like was just visited, a selection set should have been entered
          if (shouldDefineSelectionSet) {
            errorMessages.push(
              invalidSelectionSetErrorMessage(
                fieldSet,
                `${grandparentContainer.typeName}.${lastFieldName}`,
                parentTypeName,
                kindToTypeString(parentData.kind),
              ),
            );
            return BREAK;
          }
          const fieldName = node.name.value;
          const fieldPath = `${parentTypeName}.${fieldName}`;
          lastFieldName = fieldName;
          const fieldData = parentData.fieldDataByFieldName.get(fieldName);
          // undefined if the field does not exist on the parent
          if (!fieldData) {
            errorMessages.push(undefinedFieldInFieldSetErrorMessage(fieldSet, parentTypeName, fieldName));
            return BREAK;
          }
          if (fieldData.argumentDataByArgumentName.size) {
            errorMessages.push(argumentsInKeyFieldSetErrorMessage(fieldSet, fieldPath));
            return BREAK;
          }
          if (definedFields[currentDepth].has(fieldName)) {
            errorMessages.push(duplicateFieldInFieldSetErrorMessage(fieldSet, fieldPath));
            return BREAK;
          }
          definedFields[currentDepth].add(fieldName);
          // Depth 0 is the original parent type
          // If a field is external, but it's part of a key FieldSet, it will be included in the root configuration
          if (currentDepth === 0) {
            keyFieldNames.add(fieldName);
            fieldNames.add(fieldName);
          }
          getValueOrDefault(factory.keyFieldNamesByParentTypeName, parentTypeName, () => new Set<string>()).add(
            fieldName,
          );
          const namedTypeName = getNamedTypeForChild(fieldPath, fieldData.node.type);
          // The base scalars are not in the parents map
          if (BASE_SCALARS.has(namedTypeName)) {
            return;
          }
          // The child could itself be a parent and could exist as an object extension
          const childContainer =
            factory.parentDefinitionDataByTypeName.get(namedTypeName) ||
            factory.parentExtensionDataByTypeName.get(namedTypeName);
          if (!childContainer) {
            // Should not be possible to receive this error
            errorMessages.push(unknownTypeInFieldSetErrorMessage(fieldSet, fieldPath, namedTypeName));
            return BREAK;
          }
          if (
            childContainer.kind === Kind.OBJECT_TYPE_DEFINITION ||
            childContainer.kind === Kind.OBJECT_TYPE_EXTENSION
          ) {
            shouldDefineSelectionSet = true;
            parentWithFieldsDatas.push(childContainer);
            return;
          }
          // interfaces and unions are invalid in a key directive
          if (isKindAbstract(childContainer.kind)) {
            errorMessages.push(
              abstractTypeInKeyFieldSetErrorMessage(
                fieldSet,
                fieldPath,
                namedTypeName,
                kindToTypeString(childContainer.kind),
              ),
            );
            return BREAK;
          }
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
            const parentTypeName = parentData.typeName;
            const fieldPath = `${parentTypeName}.${lastFieldName}`;
            // If the last field is not an object-like
            const fieldContainer = parentData.fieldDataByFieldName.get(lastFieldName);
            if (!fieldContainer) {
              errorMessages.push(undefinedFieldInFieldSetErrorMessage(fieldSet, fieldPath, lastFieldName));
              return BREAK;
            }
            const fieldNamedTypeName = getNamedTypeForChild(fieldPath, fieldContainer.node.type);
            // If the child is not found, it's a base scalar. Undefined types would have already been handled.
            const childContainer = factory.parentDefinitionDataByTypeName.get(fieldNamedTypeName);
            const childKind = childContainer ? childContainer.kind : Kind.SCALAR_TYPE_DEFINITION;
            errorMessages.push(
              invalidSelectionSetDefinitionErrorMessage(
                fieldSet,
                fieldPath,
                fieldNamedTypeName,
                kindToTypeString(childKind),
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
            const grandparentContainer = parentWithFieldsDatas[currentDepth];
            const grandparentTypeName = grandparentContainer.typeName;
            const parentData = parentWithFieldsDatas[currentDepth + 1];
            const fieldPath = `${grandparentTypeName}.${lastFieldName}`;
            errorMessages.push(
              invalidSelectionSetErrorMessage(
                fieldSet,
                fieldPath,
                parentData.typeName,
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
    if (!errorMessages.length) {
      configurations.push({
        fieldName: '',
        selectionSet: getNormalizedFieldSet(documentNode),
        ...(disableEntityResolver ? { disableEntityResolver: true } : {}),
      });
    }
  }
  if (errorMessages.length) {
    factory.errors.push(invalidKeyDirectivesError(entityTypeName, errorMessages));
    return;
  }
  if (configurations.length) {
    return configurations;
  }
}

enum FieldSetDirective {
  PROVIDES = 'provides',
  REQUIRES = 'requires',
}

type FieldSetParentResult = {
  errorString?: string;
  fieldSetParentContainer?: ParentWithFieldsData;
};

function getFieldSetParent(
  factory: NormalizationFactory,
  fieldSetDirective: FieldSetDirective,
  parentContainer: ParentWithFieldsData,
  fieldName: string,
  parentTypeName: string,
): FieldSetParentResult {
  if (fieldSetDirective !== FieldSetDirective.PROVIDES) {
    return factory.entityContainerByTypeName.has(parentTypeName) ? { fieldSetParentContainer: parentContainer } : {};
  }
  const fieldContainer = getOrThrowError(parentContainer.fieldDataByFieldName, fieldName, `${parentTypeName}.fields`);
  const fieldNamedTypeName = getNamedTypeForChild(`${parentTypeName}.${fieldName}`, fieldContainer.node.type);

  if (!factory.entityContainerByTypeName.has(fieldNamedTypeName)) {
    return {};
  }
  const childContainer =
    factory.parentDefinitionDataByTypeName.get(fieldNamedTypeName) ||
    factory.parentExtensionDataByTypeName.get(fieldNamedTypeName);
  if (
    !childContainer ||
    (childContainer.kind !== Kind.OBJECT_TYPE_DEFINITION && childContainer.kind !== Kind.OBJECT_TYPE_EXTENSION)
  ) {
    return {
      errorString: unknownProvidesEntityErrorMessage(`${parentTypeName}.${fieldName}`, fieldNamedTypeName),
    };
  }
  return { fieldSetParentContainer: childContainer };
}

function validateProvidesOrRequires(
  factory: NormalizationFactory,
  parentContainer: ParentWithFieldsData,
  fieldSetByFieldName: Map<string, string>,
  fieldSetDirective: FieldSetDirective,
): RequiredFieldConfiguration[] | undefined {
  const errorMessages: string[] = [];
  const configurations: RequiredFieldConfiguration[] = [];
  const parentTypeName = parentContainer.typeName;
  for (const [fieldName, fieldSet] of fieldSetByFieldName) {
    /* It is possible to encounter a field before encountering the type definition.
     Consequently, at that time, it is unknown whether the named type is an entity.
     If it isn't, the @provides directive does not make sense and can be ignored.
    */
    const { fieldSetParentContainer, errorString } = getFieldSetParent(
      factory,
      fieldSetDirective,
      parentContainer,
      fieldName,
      parentTypeName,
    );
    const fieldPath = `${parentTypeName}.${fieldName}`;
    if (errorString) {
      errorMessages.push(errorString);
      continue;
    }
    if (!fieldSetParentContainer) {
      continue;
    }
    const { errorMessage, configuration } = validateNonRepeatableFieldSet(
      factory,
      fieldSetParentContainer,
      fieldSet,
      fieldName,
    );
    if (errorMessage) {
      errorMessages.push(` On "${parentTypeName}.${fieldName}" —` + errorMessage);
      continue;
    }
    if (configuration) {
      configurations.push(configuration);
      continue;
    }
    // Should never happen
    throw invalidConfigurationResultFatalError(fieldPath);
  }
  if (errorMessages.length) {
    factory.errors.push(invalidProvidesOrRequiresDirectivesError(fieldSetDirective, errorMessages));
    return;
  }
  if (configurations.length) {
    return configurations;
  }
}

export function validateAndAddDirectivesWithFieldSetToConfigurationData(
  factory: NormalizationFactory,
  parentContainer: ParentWithFieldsData,
  fieldSetContainer: FieldSetContainer,
) {
  const configurationData = getOrThrowError(
    factory.configurationDataMap,
    parentContainer.typeName,
    'configurationDataMap',
  );
  const keys = validateKeyFieldSets(
    factory,
    parentContainer,
    fieldSetContainer.keys,
    configurationData.fieldNames,
    fieldSetContainer.disableEntityResolver,
  );
  if (keys) {
    configurationData.keys = keys;
  }
  const provides = validateProvidesOrRequires(
    factory,
    parentContainer,
    fieldSetContainer.provides,
    FieldSetDirective.PROVIDES,
  );
  if (provides) {
    configurationData.provides = provides;
  }
  const requires = validateProvidesOrRequires(
    factory,
    parentContainer,
    fieldSetContainer.requires,
    FieldSetDirective.REQUIRES,
  );
  if (requires) {
    configurationData.requires = requires;
  }
}

export function isNodeQuery(typeName: string, operationTypeNode?: OperationTypeNode): boolean {
  return typeName === QUERY || operationTypeNode === OperationTypeNode.QUERY;
}
