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
  PERIOD,
  QUERY,
  QUERY_UPPER,
  SCALAR_UPPER,
  SCHEMA_UPPER,
  SUBSCRIPTION_UPPER,
  UNION_UPPER,
  VARIABLE_DEFINITION_UPPER,
} from '../utils/string-constants';
import { NormalizationFactory } from './normalization-factory';
import {
  abstractTypeInKeyFieldSetErrorMessage,
  argumentsInKeyFieldSetErrorMessage,
  duplicateFieldInFieldSetErrorMessage,
  inlineFragmentInFieldSetErrorMessage,
  inlineFragmentWithoutTypeConditionErrorMessage,
  invalidConfigurationDataErrorMessage,
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
  unknownProvidedObjectErrorMessage,
  unknownTypeInFieldSetErrorMessage,
  unparsableFieldSetErrorMessage,
  unparsableFieldSetSelectionErrorMessage,
} from '../errors/errors';
import { BASE_SCALARS } from '../utils/constants';
import { ConfigurationData, RequiredFieldConfiguration } from '../router-configuration/router-configuration';
import { FieldData, ParentWithFieldsData, UnionDefinitionData } from '../schema-building/type-definition-data';
import { getTypeNodeNamedTypeName } from '../schema-building/ast';

export type FieldSetData = {
  isUnresolvableByKeyFieldSet: Map<string, boolean>;
  provides: Map<string, string>;
  requires: Map<string, string>;
};

export function newFieldSetData(): FieldSetData {
  return {
    isUnresolvableByKeyFieldSet: new Map<string, boolean>(),
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
  let fieldPath = parentData.name;
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
        const fieldData = parentData.fieldDataByFieldName.get(fieldName);
        // undefined if the field does not exist on the parent
        if (!fieldData) {
          errorMessage = undefinedFieldInFieldSetErrorMessage(fieldSet, parentTypeName, fieldName);
          return BREAK;
        }
        if (definedFields[currentDepth].has(fieldName)) {
          errorMessage = duplicateFieldInFieldSetErrorMessage(fieldSet, fieldPath);
          return BREAK;
        }
        definedFields[currentDepth].add(fieldName);
        const namedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
        // The base scalars are not in the parents map
        if (BASE_SCALARS.has(namedTypeName)) {
          return;
        }
        // The child could itself be a parent and could exist as an object extension
        const namedTypeData =
          factory.parentDefinitionDataByTypeName.get(namedTypeName) ||
          factory.parentExtensionDataByTypeName.get(namedTypeName);
        if (!namedTypeData) {
          // Should not be possible to receive this error
          errorMessage = unknownTypeInFieldSetErrorMessage(fieldSet, fieldPath, namedTypeName);
          return BREAK;
        }
        if (
          namedTypeData.kind === Kind.OBJECT_TYPE_DEFINITION ||
          namedTypeData.kind === Kind.OBJECT_TYPE_EXTENSION ||
          namedTypeData.kind === Kind.INTERFACE_TYPE_DEFINITION ||
          namedTypeData.kind === Kind.UNION_TYPE_DEFINITION
        ) {
          shouldDefineSelectionSet = true;
          parentDatas.push(namedTypeData);
          return;
        }
      },
    },
    InlineFragment: {
      enter(node) {
        const parentData = parentDatas[currentDepth];
        const parentTypeName = parentData.name;
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
        const concreteTypeNames = factory.concreteTypeNamesByAbstractTypeName.get(parentTypeName);
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
          const fieldData = parentContainer.fieldDataByFieldName.get(lastFieldName);
          if (!fieldData) {
            errorMessage = undefinedFieldInFieldSetErrorMessage(fieldSet, fieldPath, lastFieldName);
            return BREAK;
          }
          const fieldNamedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
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
            parentContainer.name,
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
  nf: NormalizationFactory,
  entityParentData: ParentWithFieldsData,
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
    const parentWithFieldsDatas: ParentWithFieldsData[] = [entityParentData];
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
          // If an object-like was just visited, a selection set should have been entered
          if (shouldDefineSelectionSet) {
            errorMessages.push(
              invalidSelectionSetErrorMessage(
                fieldSet,
                `${grandparentData.name}.${lastFieldName}`,
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
          // The child could itself be a parent and could exist as an object extension
          const namedTypeData =
            nf.parentDefinitionDataByTypeName.get(namedTypeName) || nf.parentExtensionDataByTypeName.get(namedTypeName);
          if (!namedTypeData) {
            // Should not be possible to receive this error
            errorMessages.push(unknownTypeInFieldSetErrorMessage(fieldSet, fieldPath, namedTypeName));
            return BREAK;
          }
          if (namedTypeData.kind === Kind.OBJECT_TYPE_DEFINITION || namedTypeData.kind === Kind.OBJECT_TYPE_EXTENSION) {
            shouldDefineSelectionSet = true;
            parentWithFieldsDatas.push(namedTypeData);
            return;
          }
          // interfaces and unions are invalid in a key directive
          if (isKindAbstract(namedTypeData.kind)) {
            errorMessages.push(
              abstractTypeInKeyFieldSetErrorMessage(
                fieldSet,
                fieldPath,
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
            const fieldPath = `${parentTypeName}.${lastFieldName}`;
            // If the last field is not an object-like
            const fieldData = parentData.fieldDataByFieldName.get(lastFieldName);
            if (!fieldData) {
              errorMessages.push(undefinedFieldInFieldSetErrorMessage(fieldSet, fieldPath, lastFieldName));
              return BREAK;
            }
            const fieldNamedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
            // If the child is not found, it's a base scalar. Undefined types would have already been handled.
            const namedTypeData = nf.parentDefinitionDataByTypeName.get(fieldNamedTypeName);
            const namedTypeKind = namedTypeData ? namedTypeData.kind : Kind.SCALAR_TYPE_DEFINITION;
            errorMessages.push(
              invalidSelectionSetDefinitionErrorMessage(
                fieldSet,
                fieldPath,
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
            const grandparentContainer = parentWithFieldsDatas[currentDepth];
            const grandparentTypeName = grandparentContainer.name;
            const parentData = parentWithFieldsDatas[currentDepth + 1];
            const fieldPath = `${grandparentTypeName}.${lastFieldName}`;
            errorMessages.push(
              invalidSelectionSetErrorMessage(fieldSet, fieldPath, parentData.name, kindToTypeString(parentData.kind)),
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

enum FieldSetDirective {
  PROVIDES = 'provides',
  REQUIRES = 'requires',
}

type FieldSetParentResult = {
  errorString?: string;
  fieldSetParentData?: ParentWithFieldsData;
};

function getFieldSetParent(
  factory: NormalizationFactory,
  fieldSetDirective: FieldSetDirective,
  parentData: ParentWithFieldsData,
  fieldName: string,
  parentTypeName: string,
): FieldSetParentResult {
  if (fieldSetDirective !== FieldSetDirective.PROVIDES) {
    return factory.entityDataByTypeName.has(parentTypeName) ? { fieldSetParentData: parentData } : {};
  }
  const fieldData = getOrThrowError(
    parentData.fieldDataByFieldName,
    fieldName,
    `${parentTypeName}.fieldDataByFieldName`,
  );
  const fieldNamedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);

  const childData =
    factory.parentDefinitionDataByTypeName.get(fieldNamedTypeName) ||
    factory.parentExtensionDataByTypeName.get(fieldNamedTypeName);
  if (!childData || (childData.kind !== Kind.OBJECT_TYPE_DEFINITION && childData.kind !== Kind.OBJECT_TYPE_EXTENSION)) {
    return {
      errorString: unknownProvidedObjectErrorMessage(`${parentTypeName}.${fieldName}`, fieldNamedTypeName),
    };
  }
  return { fieldSetParentData: childData };
}

function validateProvidesOrRequires(
  nf: NormalizationFactory,
  parentData: ParentWithFieldsData,
  fieldSetByFieldName: Map<string, string>,
  fieldSetDirective: FieldSetDirective,
): RequiredFieldConfiguration[] | undefined {
  const errorMessages: string[] = [];
  const configurations: RequiredFieldConfiguration[] = [];
  const parentTypeName = parentData.name;
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
    const fieldPath = `${parentTypeName}.${fieldName}`;
    if (errorString) {
      errorMessages.push(errorString);
      continue;
    }
    if (!fieldSetParentData) {
      continue;
    }
    const { errorMessage, configuration } = validateNonRepeatableFieldSet(nf, fieldSetParentData, fieldSet, fieldName);
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
    nf.errors.push(invalidProvidesOrRequiresDirectivesError(fieldSetDirective, errorMessages));
    return;
  }
  if (configurations.length) {
    return configurations;
  }
}

export function validateAndAddFieldSetDirectivesToConfigurationData(
  factory: NormalizationFactory,
  parentData: ParentWithFieldsData,
  fieldSetData: FieldSetData,
) {
  const configurationData = getOrThrowError(
    factory.configurationDataByParentTypeName,
    parentData.name,
    'configurationDataMap',
  );
  const keys = validateKeyFieldSets(
    factory,
    parentData,
    fieldSetData.isUnresolvableByKeyFieldSet,
    configurationData.fieldNames,
  );
  if (keys) {
    configurationData.keys = keys;
    const keyFieldSets = new Set<string>();
    for (const requiredFieldConfiguration of keys) {
      if (requiredFieldConfiguration.disableEntityResolver) {
        continue;
      }
      keyFieldSets.add(requiredFieldConfiguration.selectionSet);
    }
  }
  const provides = validateProvidesOrRequires(factory, parentData, fieldSetData.provides, FieldSetDirective.PROVIDES);
  if (provides) {
    configurationData.provides = provides;
  }
  const requires = validateProvidesOrRequires(factory, parentData, fieldSetData.requires, FieldSetDirective.REQUIRES);
  if (requires) {
    configurationData.requires = requires;
  }
}

export function isNodeQuery(typeName: string, operationTypeNode?: OperationTypeNode): boolean {
  return typeName === QUERY || operationTypeNode === OperationTypeNode.QUERY;
}
