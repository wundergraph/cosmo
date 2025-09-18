import { Kind, OperationTypeNode } from 'graphql';
import {
  EntityInterfaceFederationData,
  FieldData,
  InputValueData,
  ObjectDefinitionData,
} from '../schema-building/types';
import {
  IncompatibleMergedTypesErrorParams,
  InvalidNamedTypeErrorParams,
  InvalidRootTypeFieldEventsDirectiveData,
  OneOfRequiredFieldsErrorParams,
  SemanticNonNullLevelsIndexOutOfBoundsErrorParams,
  SemanticNonNullLevelsNonNullErrorParams,
} from './types';
import { UnresolvableFieldData } from '../resolvability-graph/utils';
import {
  AND_UPPER,
  ARGUMENT,
  FIELD,
  FIELD_PATH,
  IN_UPPER,
  INPUT_FIELD,
  INTERFACE,
  LEVELS,
  LITERAL_NEW_LINE,
  NOT_UPPER,
  OR_UPPER,
  QUOTATION_JOIN,
  SUBSCRIPTION_FIELD_CONDITION,
  SUBSCRIPTION_FILTER,
  SUBSCRIPTION_FILTER_CONDITION,
  SUBSCRIPTION_FILTER_VALUE,
  UNION,
  VALUES,
} from '../utils/string-constants';
import { MAX_SUBSCRIPTION_FILTER_DEPTH, MAXIMUM_TYPE_NESTING } from '../utils/integer-constants';
import { getEntriesNotInHashSet, getOrThrowError, kindToNodeType, numberToOrdinal } from '../utils/utils';
import { ImplementationErrors, InvalidEntityInterface, InvalidRequiredInputValueData } from '../utils/types';
import { isFieldData } from '../schema-building/utils';
import { printTypeNode } from '@graphql-tools/merge';
import { NodeType, TypeName } from '../types/types';

export const minimumSubgraphRequirementError = new Error('At least one subgraph is required for federation.');

export function multipleNamedTypeDefinitionError(
  typeName: string,
  firstTypeString: string,
  secondTypeString: string,
): Error {
  return new Error(
    `The named type "${typeName}" is defined as both types "${firstTypeString}" and "${secondTypeString}".` +
      `\nHowever, there must be only one type named "${typeName}".`,
  );
}

export function incompatibleInputValueDefaultValueTypeError(
  prefix: string,
  path: string,
  typeString: string,
  defaultValue: string,
): Error {
  return new Error(
    `The ${prefix} of type "${typeString}" defined on path "${path}" is` +
      ` incompatible with the default value of "${defaultValue}".`,
  );
}

export function incompatibleMergedTypesError({
  actualType,
  coords,
  expectedType,
  isArgument,
}: IncompatibleMergedTypesErrorParams): Error {
  return new Error(
    `Incompatible types when merging two instances of ${isArgument ? 'field argument' : FIELD} "${coords}":\n` +
      ` Expected type "${expectedType}" but received "${actualType}".`,
  );
}

export function incompatibleInputValueDefaultValuesError(
  prefix: string,
  path: string,
  subgraphNames: string[],
  expectedDefaultValue: string,
  actualDefaultValue: string,
) {
  return new Error(
    `Expected the ${prefix} defined on path "${path}" to define the default value "${expectedDefaultValue}".\n"` +
      `However, the default value "${actualDefaultValue}" is defined in the following subgraph` +
      (subgraphNames.length > 1 ? 's' : '') +
      `:\n "` +
      subgraphNames.join(QUOTATION_JOIN) +
      `"\n` +
      'If an instance defines a default value, that default value must be consistently defined across all subgraphs.',
  );
}

export function incompatibleSharedEnumError(parentName: string): Error {
  return new Error(
    `Enum "${parentName}" was used as both an input and output but was inconsistently defined across inclusive subgraphs.`,
  );
}

export function invalidSubgraphNamesError(names: string[], invalidNameErrorMessages: string[]): Error {
  let message = 'Subgraphs to be federated must each have a unique, non-empty name.';
  if (names.length > 0) {
    message += '\n The following subgraph names are not unique:\n  "' + names.join('", "') + `"`;
  }
  for (const invalidNameErrorMessage of invalidNameErrorMessages) {
    message += `\n ${invalidNameErrorMessage}`;
  }
  return new Error(message);
}

export function duplicateDirectiveDefinitionError(directiveName: string) {
  return new Error(`The directive "${directiveName}" must only be defined once.`);
}

export function duplicateEnumValueDefinitionError(enumTypeName: string, valueName: string): Error {
  return new Error(`The Enum "${enumTypeName}" must only define the Enum value definition "${valueName}" once.`);
}

export function duplicateFieldDefinitionError(typeString: string, typeName: string, fieldName: string): Error {
  return new Error(`The ${typeString} "${typeName}" must only define the field definition "${fieldName}" once.`);
}

export function duplicateInputFieldDefinitionError(inputObjectTypeName: string, fieldName: string): Error {
  return new Error(
    `The Input Object "${inputObjectTypeName}" must only define the Input field definition "${fieldName}" once.`,
  );
}

export function duplicateImplementedInterfaceError(typeString: string, typeName: string, interfaceName: string): Error {
  return new Error(`The ${typeString} "${typeName}" must only implement the Interface "${interfaceName}" once.`);
}

export function duplicateUnionMemberDefinitionError(unionTypeName: string, memberName: string): Error {
  return new Error(`The Union "${unionTypeName}" must only define the Union member "${memberName}" once.`);
}

export function duplicateTypeDefinitionError(type: string, typeName: string): Error {
  return new Error(`The ${type} "${typeName}" must only be defined once.`);
}

export function duplicateOperationTypeDefinitionError(
  operationTypeName: OperationTypeNode,
  newTypeName: string,
  oldTypeName: string,
): Error {
  return new Error(
    `The operation type "${operationTypeName}" cannot be defined as "${newTypeName}"` +
      ` because it has already been defined as "${oldTypeName}".`,
  );
}

export function noBaseDefinitionForExtensionError(typeString: string, typeName: string): Error {
  return new Error(
    `The ${typeString} "${typeName}" is an extension,` +
      ` but no base ${typeString} definition of "${typeName}" is defined in any subgraph.`,
  );
}

export function noBaseScalarDefinitionError(typeName: string): Error {
  return new Error(
    `The Scalar extension "${typeName}" is invalid because no base Scalar definition` +
      ` of "${typeName} is defined in the subgraph.`,
  );
}

export function noDefinedUnionMembersError(unionTypeName: string): Error {
  return new Error(`The Union "${unionTypeName}" must define at least one Union member.`);
}

export function noDefinedEnumValuesError(enumTypeName: string): Error {
  return new Error(`The Enum "${enumTypeName}" must define at least one Enum value.`);
}

export function operationDefinitionError(typeName: string, operationType: OperationTypeNode, actualType: Kind): Error {
  return new Error(
    `Expected the response type "${typeName}" for operation "${operationType}" to be type Object but received "${actualType}.`,
  );
}

export function invalidFieldShareabilityError(objectData: ObjectDefinitionData, invalidFieldNames: Set<string>): Error {
  const parentTypeName = objectData.name;
  const errorMessages: string[] = [];
  for (const [fieldName, fieldData] of objectData.fieldDataByName) {
    if (!invalidFieldNames.has(fieldName)) {
      continue;
    }
    const shareableSubgraphs: string[] = [];
    const nonShareableSubgraphs: string[] = [];
    for (const [subgraphName, isShareable] of fieldData.isShareableBySubgraphName) {
      isShareable ? shareableSubgraphs.push(subgraphName) : nonShareableSubgraphs.push(subgraphName);
    }
    if (shareableSubgraphs.length < 1) {
      errorMessages.push(
        `\n The field "${fieldName}" is defined in the following subgraphs: "${[...fieldData.subgraphNames].join(
          '", "',
        )}".` + `\n However, it is not declared "@shareable" in any of them.`,
      );
    } else {
      errorMessages.push(
        `\n The field "${fieldName}" is defined and declared "@shareable" in the following subgraph` +
          (shareableSubgraphs.length > 1 ? 's' : '') +
          `: "` +
          shareableSubgraphs.join(QUOTATION_JOIN) +
          `".` +
          `\n However, it is not declared "@shareable" in the following subgraph` +
          (nonShareableSubgraphs.length > 1 ? 's' : '') +
          `: "${nonShareableSubgraphs.join(QUOTATION_JOIN)}".`,
      );
    }
  }
  return new Error(
    `The Object "${parentTypeName}" defines the same fields in multiple subgraphs without the "@shareable" directive:` +
      `${errorMessages.join('\n')}`,
  );
}

export function undefinedDirectiveError(directiveName: string, directiveCoords: string): Error {
  return new Error(
    `The directive "@${directiveName}" declared on coordinates "${directiveCoords}" is not defined in the schema.`,
  );
}
export function undefinedTypeError(typeName: string): Error {
  return new Error(` The type "${typeName}" was referenced in the schema, but it was never defined.`);
}

export function invalidRepeatedDirectiveErrorMessage(directiveName: string): string {
  return `The definition for the directive "@${directiveName}" does not define it as repeatable, but it is declared more than once on these coordinates.`;
}

export function invalidDirectiveError(
  directiveName: string,
  directiveCoords: string,
  ordinal: string,
  errorMessages: Array<string>,
): Error {
  return new Error(
    `The ${ordinal} instance of the directive "@${directiveName}" declared on coordinates "${directiveCoords}" is invalid for the following reason` +
      (errorMessages.length > 1 ? 's:\n' : ':\n') +
      errorMessages.join('\n'),
  );
}

export function invalidRepeatedFederatedDirectiveErrorMessage(directiveName: string, directiveCoords: string): Error {
  return new Error(
    `The definition for the directive "@${directiveName}" does not define it as repeatable,` +
      ` but the directive has been declared on more than one instance of the type "${directiveCoords}".`,
  );
}

export function invalidDirectiveLocationErrorMessage(directiveName: string, location: string): string {
  return ` The definition for "@${directiveName}" does not define "${location}" as a valid location.`;
}

export function undefinedRequiredArgumentsErrorMessage(
  directiveName: string,
  requiredArgumentNames: string[],
  undefinedArgumentNames: string[],
): string {
  let message =
    ` The definition for "@${directiveName}" defines the following ` +
    requiredArgumentNames.length +
    ` required argument` +
    (requiredArgumentNames.length > 1 ? 's: ' : ': ') +
    `"` +
    requiredArgumentNames.join('", "') +
    `"` +
    `.\n However,`;
  if (undefinedArgumentNames.length < 1) {
    return message + ` no arguments are defined on this instance.`;
  }
  return (
    message +
    ` the following required argument` +
    (undefinedArgumentNames.length > 1 ? `s are` : ` is`) +
    ` not defined on this instance: "` +
    undefinedArgumentNames.join(QUOTATION_JOIN) +
    `".`
  );
}

export function unexpectedDirectiveArgumentErrorMessage(directiveName: string, argumentNames: string[]): string {
  return (
    ` The definition for "@${directiveName}" does not define the following argument` +
    (argumentNames.length > 1 ? 's that are' : ' that is') +
    ` provided: "` +
    argumentNames.join(QUOTATION_JOIN) +
    `".`
  );
}

export function duplicateDirectiveArgumentDefinitionsErrorMessage(argumentNames: string[]): string {
  return (
    ` The following argument` +
    (argumentNames.length > 1 ? 's are' : ' is') +
    ` defined more than once: "` +
    argumentNames.join(QUOTATION_JOIN) +
    `"`
  );
}

export function invalidArgumentValueErrorMessage(
  value: string,
  hostName: string,
  argumentName: string,
  expectedTypeString: string,
): string {
  return ` The value "${value}" provided to argument "${hostName}(${argumentName}: ...)" is not a valid "${expectedTypeString}" type.`;
}

export function maximumTypeNestingExceededError(path: string): Error {
  return new Error(
    ` The type defined at path "${path}" has more than ${MAXIMUM_TYPE_NESTING} layers of nesting,` +
      ` or there is a cyclical error.`,
  );
}

export function unexpectedKindFatalError(typeName: string) {
  return new Error(`Fatal: Unexpected type for "${typeName}"`);
}

export function incompatibleParentKindFatalError(parentTypeName: string, expectedKind: Kind, actualKind: Kind): Error {
  return new Error(
    `Fatal: Expected "${parentTypeName}" to be type ${kindToNodeType(expectedKind)}` +
      ` but received "${kindToNodeType(actualKind)}".`,
  );
}

export function unexpectedEdgeFatalError(typeName: string, edgeNames: Array<string>): Error {
  return new Error(
    `Fatal: The type "${typeName}" visited the following unexpected edge` +
      (edgeNames.length > 1 ? 's' : '') +
      `:\n " ${edgeNames.join(QUOTATION_JOIN)}".`,
  );
}

export function incompatibleParentKindMergeError(
  parentTypeName: string,
  expectedTypeString: string,
  actualTypeString: string,
): Error {
  return new Error(
    ` When merging types, expected "${parentTypeName}" to be type "${expectedTypeString}" but received "${actualTypeString}".`,
  );
}

export function fieldTypeMergeFatalError(fieldName: string) {
  return new Error(
    `Fatal: Unsuccessfully merged the cross-subgraph types of field "${fieldName}"` +
      ` without producing a type error object.`,
  );
}

export function unexpectedTypeNodeKindFatalError(typePath: string): Error {
  return new Error(
    `Fatal: Expected all constituent types at path "${typePath}" to be one of the following: ` +
      `"LIST_TYPE", "NAMED_TYPE", or "NON_NULL_TYPE".`,
  );
}

export function invalidKeyFatalError<K>(key: K, mapName: string): Error {
  return new Error(`Fatal: Expected key "${key}" to exist in the map "${mapName}".`);
}

export const subgraphValidationFailureError: Error = new Error(
  ` Fatal: Subgraph validation did not return a valid AST.`,
);

export function unexpectedParentKindForChildError(
  parentTypeName: string,
  expectedTypeString: string,
  actualTypeString: string,
  childName: string,
  childTypeString: string,
): Error {
  return new Error(
    ` Expected "${parentTypeName}" to be type ${expectedTypeString} but received "${actualTypeString}"` +
      ` when handling child "${childName}" of type "${childTypeString}".`,
  );
}

export function subgraphValidationError(subgraphName: string, errors: Error[]): Error {
  return new Error(
    `The subgraph "${subgraphName}" could not be federated for the following reason` +
      (errors.length > 1 ? 's' : '') +
      `:\n` +
      errors.map((error) => error.message).join('\n'),
  );
}

export function invalidSubgraphNameErrorMessage(index: number, newName: string): string {
  return (
    `The ${numberToOrdinal(index + 1)} subgraph in the array did not define a name.` +
    ` Consequently, any further errors will temporarily identify this subgraph as "${newName}".`
  );
}

export function invalidOperationTypeDefinitionError(
  existingOperationType: OperationTypeNode,
  typeName: string,
  newOperationType: OperationTypeNode,
): Error {
  return new Error(
    `The schema definition defines the "${existingOperationType}" operation as type "${typeName}".` +
      ` However, "${typeName}" was also used for the "${newOperationType}" operation.\n` +
      ` If explicitly defined, each operation type must be a unique and valid Object type.`,
  );
}

export function invalidRootTypeDefinitionError(
  operationType: OperationTypeNode,
  typeName: string,
  defaultTypeName: string,
): Error {
  return new Error(
    `The schema definition defines the "${operationType}" operation as type "${typeName}".` +
      ` However, the schema also defines another type named "${defaultTypeName}",` +
      ` which is the default (root) type name for the "${operationType}" operation.\n` +
      `For federation, it is only possible to use the default root types names ("Mutation", "Query", "Subscription") as` +
      ` operation definitions. No other definitions with these default root type names are valid.`,
  );
}

export function subgraphInvalidSyntaxError(error?: Error): Error {
  let message = `The subgraph has syntax errors and could not be parsed.`;
  if (error) {
    message += `\n The reason provided was: ` + error.message;
  }
  return new Error(message);
}

export function invalidInterfaceImplementationError(
  parentTypeName: TypeName,
  parentNodeType: NodeType,
  implementationErrorsByInterfaceTypeName: Map<TypeName, ImplementationErrors>,
): Error {
  const messages: string[] = [];
  for (const [interfaceName, implementationErrors] of implementationErrorsByInterfaceTypeName) {
    let message =
      ` The implementation of Interface "${interfaceName}" by "${parentTypeName}"` + ` is invalid because:\n`;
    const unimplementedFieldsLength = implementationErrors.unimplementedFields.length;
    if (unimplementedFieldsLength) {
      message +=
        `  The following field${unimplementedFieldsLength > 1 ? 's are' : ' is'} not implemented: "` +
        implementationErrors.unimplementedFields.join('", "') +
        '"\n';
    }
    for (const [fieldName, invalidFieldImplementation] of implementationErrors.invalidFieldImplementations) {
      const unimplementedArgumentsSize = invalidFieldImplementation.unimplementedArguments.size;
      const invalidArgumentsLength = invalidFieldImplementation.invalidImplementedArguments.length;
      const invalidAdditionalArgumentsSize = invalidFieldImplementation.invalidAdditionalArguments.size;
      message += `  The field "${fieldName}" is invalid because:\n`;
      if (unimplementedArgumentsSize) {
        message +=
          `   The following argument${unimplementedArgumentsSize > 1 ? 's are' : ' is'} not implemented: "` +
          [...invalidFieldImplementation.unimplementedArguments].join('", "') +
          '"\n';
      }
      if (invalidArgumentsLength) {
        message += `   The following implemented argument${invalidArgumentsLength > 1 ? 's are' : ' is'} invalid:\n`;
        for (const invalidArgument of invalidFieldImplementation.invalidImplementedArguments) {
          message +=
            `    The argument "${invalidArgument.argumentName}" must define type "` +
            invalidArgument.expectedType +
            `" and not "${invalidArgument.actualType}"\n`;
        }
      }
      if (invalidAdditionalArgumentsSize) {
        message +=
          `   If a field from an Interface is implemented, any additional Arguments that were not defined` +
          ` on the original Interface field must be optional (nullable).\n`;
        message +=
          `    The following additional argument` +
          (invalidFieldImplementation.invalidAdditionalArguments.size > 1 ? `s are` : ` is`) +
          ` not defined as optional: "` +
          [...invalidFieldImplementation.invalidAdditionalArguments].join(`", "`) +
          `"\n`;
      }
      if (invalidFieldImplementation.implementedResponseType) {
        message +=
          `   The implemented response type "${invalidFieldImplementation.implementedResponseType}" is not` +
          ` a valid subtype (equally or more restrictive) of the response type "` +
          invalidFieldImplementation.originalResponseType +
          `" for "${interfaceName}.${fieldName}".\n`;
      }
      if (invalidFieldImplementation.isInaccessible) {
        message +=
          `   The field has been declared "@inaccessible"; however, the same field has not been declared "@inaccessible"` +
          ` on the Interface definition.\n   Consequently, the Interface implementation cannot be satisfied.\n`;
      }
    }
    messages.push(message);
  }
  return new Error(
    `The ${parentNodeType} "${parentTypeName}" has the following Interface implementation errors:\n` +
      messages.join('\n'),
  );
}

export function invalidRequiredInputValueError(
  typeString: string,
  path: string,
  errors: InvalidRequiredInputValueData[],
  isArgument = true,
): Error {
  const inputValueTypeString = isArgument ? ARGUMENT : INPUT_FIELD;
  let message = `The ${typeString} "${path}" could not be federated because:\n`;
  for (const error of errors) {
    message +=
      ` The ${inputValueTypeString} "${error.inputValueName}" is required in the following subgraph` +
      (error.requiredSubgraphs.length > 1 ? 's' : '') +
      ': "' +
      error.requiredSubgraphs.join(`", "`) +
      `"\n` +
      ` However, the ${inputValueTypeString} "${error.inputValueName}" is not defined in the following subgraph` +
      (error.missingSubgraphs.length > 1 ? 's' : '') +
      ': "' +
      error.missingSubgraphs.join(`", "`) +
      `"\n` +
      ` If an ${inputValueTypeString} is required on a ${typeString} in any one subgraph, it must be at least defined` +
      ` as optional on all other definitions of that ${typeString} in all other subgraphs.\n`;
  }
  return new Error(message);
}

export function duplicateArgumentsError(fieldPath: string, duplicatedArguments: string[]): Error {
  return new Error(
    `The field "${fieldPath}" is invalid because:\n` +
      ` The following argument` +
      (duplicatedArguments.length > 1 ? 's are' : ' is') +
      ` defined more than once: "` +
      duplicatedArguments.join(QUOTATION_JOIN) +
      `"\n`,
  );
}

export function noQueryRootTypeError(isRouterSchema = true): Error {
  return new Error(
    `The ${isRouterSchema ? 'router' : 'client'} schema does not define at least one accessible query root` +
      ` type field after federation was completed, which is necessary for a federated graph to be valid.\n` +
      ` For example:\n` +
      `  type Query {\n` +
      `    dummy: String\n` +
      `  }`,
  );
}

export const inaccessibleQueryRootTypeError = new Error(
  `The root query type "Query" must be present in the client schema;` +
    ` consequently, it must not be declared "@inaccessible".`,
);

export function expectedEntityError(typeName: string): Error {
  return new Error(`Expected object "${typeName}" to define a "key" directive, but it defines no directives.`);
}

export const inlineFragmentInFieldSetErrorMessage = ` Inline fragments are not currently supported within a field set argument.`;

export function abstractTypeInKeyFieldSetErrorMessage(
  fieldSet: string,
  fieldCoords: string,
  abstractTypeName: string,
  abstractTypeString: string,
): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because "${fieldCoords}" returns "${abstractTypeName}", which is type "${abstractTypeString}".\n` +
    ` Fields that return abstract types (Interfaces and Unions)` +
    ` cannot be included in the field set of "@key" directives.`
  );
}

export function unknownTypeInFieldSetErrorMessage(
  fieldSet: string,
  fieldCoords: string,
  responseTypeName: string,
): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because "${fieldCoords}" returns the unknown type "${responseTypeName}".`
  );
}

export function invalidSelectionSetErrorMessage(
  fieldSet: string,
  fieldCoordinatesPath: Array<string>,
  selectionSetTypeName: string,
  fieldTypeString: string,
): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because of the selection set corresponding to the ` +
    getSelectionSetLocationWithTypeString(fieldCoordinatesPath, selectionSetTypeName, fieldTypeString) +
    ` Composite types such as "${fieldTypeString}" types must define a selection set with at least one field selection.`
  );
}

export function invalidSelectionSetDefinitionErrorMessage(
  fieldSet: string,
  fieldCoordinatesPath: Array<string>,
  selectionSetTypeName: string,
  fieldTypeString: string,
): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because of the selection set corresponding to the ` +
    getSelectionSetLocationWithTypeString(fieldCoordinatesPath, selectionSetTypeName, fieldTypeString) +
    ` Non-composite types such as "${fieldTypeString}" cannot define a selection set.`
  );
}

export function undefinedFieldInFieldSetErrorMessage(
  fieldSet: string,
  parentTypeName: string,
  fieldName: string,
): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because of the selection set corresponding to the field coordinates "${parentTypeName}.${fieldName}".\n` +
    ` The type "${parentTypeName}" does not define a field named "${fieldName}".`
  );
}

export function unparsableFieldSetErrorMessage(fieldSet: string, error?: Error): string {
  let message = ` The following field set is invalid:\n  "${fieldSet}"\n` + ` The field set could not be parsed.`;
  if (error) {
    message += `\n The reason provided was: ` + error.message;
  }
  return message;
}

export function unparsableFieldSetSelectionErrorMessage(fieldSet: string, fieldName: string): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because the selection set defined on "${fieldName}" could not be parsed.`
  );
}

export function undefinedCompositeOutputTypeError(parentTypeName: string): Error {
  return new Error(` Expected an object/interface or object/interface extension named "${parentTypeName}" to exist.`);
}

export function unexpectedArgumentErrorMessage(fieldSet: string, fieldPath: string, argumentName: string): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because "${fieldPath}" does not define an argument named "${argumentName}".`
  );
}

export function argumentsInKeyFieldSetErrorMessage(fieldSet: string, fieldPath: string): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because "${fieldPath}" defines arguments.\n` +
    ` Fields that define arguments cannot be included in the field set of @key directives.`
  );
}

export function invalidProvidesOrRequiresDirectivesError(directiveName: string, errorMessages: string[]): Error {
  return new Error(
    `The following "${directiveName}" directive` +
      (errorMessages.length > 1 ? 's are' : ' is') +
      ` invalid:\n` +
      errorMessages.join(`\n`),
  );
}

export function duplicateFieldInFieldSetErrorMessage(fieldSet: string, fieldPath: string): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because "${fieldPath}" was included in the field set more than once.`
  );
}

export function invalidConfigurationDataErrorMessage(typeName: string, fieldName: string, fieldSet: string): string {
  return (
    ` Expected ConfigurationData to exist for type "${typeName}" when adding field "${fieldName}"` +
    `  while validating field set "${fieldSet}".`
  );
}

export function incompatibleTypeWithProvidesErrorMessage(fieldCoords: string, responseType: string): string {
  return (
    ` A "@provides" directive is declared on field "${fieldCoords}".\n` +
    ` However, the response type "${responseType}" is not an Object nor Interface.`
  );
}

function getSelectionSetLocation(
  fieldCoordinatesPath: Array<string>,
  selectionSetTypeName: string,
  withReturnType: boolean = false,
): string {
  /* fieldCoordinatesPath can have length 0 if it's a @requires directive,
   * in which case the first part of the field set refers to the enclosing parent type.
   * */
  if (fieldCoordinatesPath.length < 1) {
    return `enclosing type name "${selectionSetTypeName}".\n`;
  }
  return (
    `field coordinates "${fieldCoordinatesPath[fieldCoordinatesPath.length - 1]}"` +
    (withReturnType ? ` that returns "${selectionSetTypeName}"` : '') +
    `.\n`
  );
}

function getSelectionSetLocationWithTypeString(
  fieldCoordinatesPath: Array<string>,
  selectionSetTypeName: string,
  typeString: string,
): string {
  /* fieldCoordinatesPath can have length 0 if it's a @requires directive,
   * in which case the first part of the field set refers to the enclosing parent type.
   * */
  if (fieldCoordinatesPath.length < 1) {
    return `enclosing type name "${selectionSetTypeName}", which is type "${typeString}".\n`;
  }
  return (
    `field coordinates "${fieldCoordinatesPath[fieldCoordinatesPath.length - 1]}"` +
    ` that returns "${selectionSetTypeName}", which is type "${typeString}".\n`
  );
}

export function invalidInlineFragmentTypeErrorMessage(
  fieldSet: string,
  fieldCoordinatesPath: Array<string>,
  typeConditionName: string,
  selectionSetTypeName: string,
): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because an inline fragment with the type condition "${typeConditionName}" is defined on the` +
    ` selection set corresponding to the ` +
    getSelectionSetLocation(fieldCoordinatesPath, selectionSetTypeName, true) +
    ` However, "${selectionSetTypeName}" is not an abstract (Interface or Union) type.\n` +
    ` Consequently, the only valid type condition at this selection set would be "${selectionSetTypeName}".`
  );
}

export function inlineFragmentWithoutTypeConditionErrorMessage(fieldSet: string, fieldPath: string): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because "${fieldPath}" defines an inline fragment without a type condition.`
  );
}

export function unknownInlineFragmentTypeConditionErrorMessage(
  fieldSet: string,
  fieldCoordinatesPath: Array<string>,
  selectionSetTypeName: string,
  typeConditionName: string,
): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because an inline fragment with the unknown type condition "${typeConditionName}" is defined on the` +
    ` selection set corresponding to the ` +
    getSelectionSetLocation(fieldCoordinatesPath, selectionSetTypeName)
  );
}

export function invalidInlineFragmentTypeConditionTypeErrorMessage(
  fieldSet: string,
  fieldCoordinatesPath: Array<string>,
  selectionSetTypeName: string,
  typeConditionName: string,
  typeConditionTypeString: string,
): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because an inline fragment with the type condition "${typeConditionName}" is defined on the` +
    ` selection set corresponding to the ` +
    getSelectionSetLocation(fieldCoordinatesPath, selectionSetTypeName) +
    ` However, "${typeConditionName}" is type "${typeConditionTypeString}" when types "Interface" or "Object" would` +
    ` be expected.`
  );
}

export function invalidInlineFragmentTypeConditionErrorMessage(
  fieldSet: string,
  fieldCoordinatesPath: Array<string>,
  typeConditionName: string,
  parentTypeString: string,
  selectionSetTypeName: string,
): string {
  const message =
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because an inline fragment with the type condition "${typeConditionName}" is defined on the` +
    ` selection set corresponding to the ` +
    getSelectionSetLocationWithTypeString(fieldCoordinatesPath, selectionSetTypeName, parentTypeString);
  if (parentTypeString === INTERFACE) {
    return message + ` However, "${typeConditionName}" does not implement "${selectionSetTypeName}"`;
  }
  return message + ` However, "${typeConditionName}" is not a member of "${selectionSetTypeName}".`;
}

export function invalidSelectionOnUnionErrorMessage(
  fieldSet: string,
  fieldCoordinatesPath: Array<string>,
  selectionSetTypeName: string,
): string {
  return (
    ` The following field set is invalid:\n  "${fieldSet}"\n` +
    ` This is because of the selection set corresponding to the ` +
    getSelectionSetLocationWithTypeString(fieldCoordinatesPath, selectionSetTypeName, UNION) +
    ` Union types such as "${selectionSetTypeName}" must define field selections (besides "__typename") on an` +
    ` inline fragment whose type condition corresponds to a constituent union member.`
  );
}

export function duplicateOverriddenFieldErrorMessage(fieldPath: string, subgraphNames: string[]): string {
  return (
    ` The field "${fieldPath}" declares an @override directive in the following subgraphs: "` +
    subgraphNames.join(QUOTATION_JOIN) +
    `".`
  );
}

export function duplicateOverriddenFieldsError(errorMessages: string[]): Error {
  return new Error(
    `The "@override" directive must only be declared on one single instance of a field.` +
      ` However, an "@override" directive was declared on more than one instance of the following field` +
      (errorMessages.length > 1 ? 's' : '') +
      `: "` +
      errorMessages.join(QUOTATION_JOIN) +
      `".\n`,
  );
}

export function noFieldDefinitionsError(typeString: string, typeName: string): Error {
  return new Error(`The ${typeString} "${typeName}" is invalid because it does not define any fields.`);
}

export function noInputValueDefinitionsError(inputTypeName: string): Error {
  return new Error(`The Input Object "${inputTypeName}" is invalid because it does not define any input values.`);
}

export function allChildDefinitionsAreInaccessibleError(
  typeString: string,
  typeName: string,
  childType: string,
): Error {
  return new Error(
    `The ${typeString} "${typeName}" is invalid because all its ${childType} definitions are declared "@inaccessible".`,
  );
}

export function equivalentSourceAndTargetOverrideErrorMessage(subgraphName: string, hostPath: string): string {
  return `Cannot override field "${hostPath}" because the source and target subgraph names are both "${subgraphName}"`;
}

export function undefinedEntityInterfaceImplementationsError(
  invalidEntityInterfacesByTypeName: Map<string, InvalidEntityInterface[]>,
  entityInterfaceFederationDataByTypeName: Map<string, EntityInterfaceFederationData>,
): Error {
  let message =
    `Federation was unsuccessful because any one subgraph that defines a specific entity Interface` +
    ` must also define each and every entity Object that implements that entity Interface.\n` +
    `Each entity Object must also explicitly define its implementation of the entity Interface.\n`;
  for (const [typeName, undefinedImplementations] of invalidEntityInterfacesByTypeName) {
    const entityInterfaceDatas = getOrThrowError(
      entityInterfaceFederationDataByTypeName,
      typeName,
      'entityInterfaceFederationDataByTypeName',
    );
    const implementedConcreteTypeNames = entityInterfaceDatas.concreteTypeNames!;
    message +=
      ` Across all subgraphs, the entity interface "${typeName}" is implemented by the following entit` +
      (implementedConcreteTypeNames.size > 1 ? `ies` : `y`) +
      `:\n  "` +
      Array.from(implementedConcreteTypeNames).join(QUOTATION_JOIN) +
      `"\n` +
      ` However, the definition of at least one of these implementations is missing in a subgraph that` +
      ` defines the entity interface "${typeName}":\n`;
    for (const { subgraphName, definedConcreteTypeNames } of undefinedImplementations) {
      const disparities = getEntriesNotInHashSet(implementedConcreteTypeNames, definedConcreteTypeNames);
      message +=
        `  Subgraph "${subgraphName}" does not define the following implementations: "` +
        disparities.join(QUOTATION_JOIN) +
        `"\n`;
    }
  }
  return new Error(message);
}

export function orScopesLimitError(maxOrScopes: number, directiveCoords: string[]): Error {
  return new Error(
    `The maximum number of OR scopes that can be defined by @requiresScopes on a single field is ${maxOrScopes}.` +
      ` However, the following coordinates attempt to define more:\n "` +
      directiveCoords.join(QUOTATION_JOIN) +
      `"\nIf you require more, please contact support.`,
  );
}

export function invalidEventDrivenGraphError(errorMessages: string[]): Error {
  return new Error(
    `An "Event Driven" graph—a subgraph that defines event driven directives—must not define any resolvers.\n` +
      `Consequently, any "@key" definitions must also include the "resolvable: false" argument.\n` +
      `Moreover, only fields that compose part of an entity's (composite) key and are` +
      ` declared "@external" are permitted.\n` +
      errorMessages.join('\n'),
  );
}

export function invalidRootTypeFieldEventsDirectivesErrorMessage(
  invalidEventsDirectiveDataByRootFieldPath: Map<string, InvalidRootTypeFieldEventsDirectiveData>,
): string {
  let message =
    ` Root type fields defined in an Event Driven graph must define a valid events` +
    ` directive:\n  Mutation type fields must define either a edfs publish or request directive."\n` +
    `  Query type fields must define "@edfs__natsRequest"\n  Subscription type fields must define an edfs subscribe` +
    ` directive\n The following root field path` +
    (invalidEventsDirectiveDataByRootFieldPath.size > 1 ? 's are' : ' is') +
    ` invalid:\n`;
  for (const [fieldPath, data] of invalidEventsDirectiveDataByRootFieldPath) {
    if (!data.definesDirectives) {
      message += `  The root field path "${fieldPath}" does not define any valid events directives.\n`;
    } else {
      message +=
        `  The root field path "${fieldPath}" defines the following invalid events directive` +
        (data.invalidDirectiveNames.length > 1 ? `s` : ``) +
        `: "@` +
        data.invalidDirectiveNames.join(`", "@`) +
        `"\n`;
    }
  }
  return message;
}

export function invalidEventDrivenMutationResponseTypeErrorMessage(
  invalidResponseTypeStringByMutationPath: Map<string, string>,
): string {
  let message =
    ` Mutation type fields defined in an Event Driven graph must return the non-nullable type` +
    ` "edfs__PublishResult!", which has the following definition:\n  type edfs__PublishResult {\n` +
    `   success: Boolean!\n  }\n However, the following mutation field path` +
    (invalidResponseTypeStringByMutationPath.size > 1 ? `s are` : ` is`) +
    ` invalid:\n`;
  for (const [path, responseTypeString] of invalidResponseTypeStringByMutationPath) {
    message += `  The mutation field path "${path}" returns "${responseTypeString}".\n`;
  }
  return message;
}

export function invalidRootTypeFieldResponseTypesEventDrivenErrorMessage(
  invalidResponseTypeStringByRootFieldPath: Map<string, string>,
): string {
  let message =
    ` The named response type of root type fields defined in an Event Driven graph must be a` +
    ` non-nullable, non-list named type that is either an entity, an interface implemented by` +
    ` an entity, or a union of which an entity is a member.\n Consequently, the following root field path` +
    (invalidResponseTypeStringByRootFieldPath.size > 1 ? 's are' : ' is') +
    ` invalid:\n`;
  for (const [fieldPath, responseTypeString] of invalidResponseTypeStringByRootFieldPath) {
    message += `  The root field path "${fieldPath}", which returns the invalid type "${responseTypeString}"\n`;
  }
  return message;
}

export const invalidNatsStreamInputErrorMessage =
  `The "streamConfiguration" argument must be a valid input object with the following form:\n` +
  `  input edfs__NatsStreamConfiguration {\n    consumerInactiveThreshold: Int! = 30\n    consumerName: String!\n    streamName: String!\n  }`;

export function invalidNatsStreamInputFieldsErrorMessage(
  missingRequiredFieldNames: string[],
  duplicateRequiredFieldNames: string[],
  invalidRequiredFieldNames: string[],
  invalidFieldNames: string[],
): string {
  let message = invalidNatsStreamInputErrorMessage;
  const errorMessages: string[] = [];
  if (missingRequiredFieldNames.length > 0) {
    errorMessages.push(
      `The following required field` +
        (missingRequiredFieldNames.length > 1 ? `s were` : ` was`) +
        ` not defined: "` +
        missingRequiredFieldNames.join(QUOTATION_JOIN) +
        `".`,
    );
  }
  if (duplicateRequiredFieldNames.length > 0) {
    errorMessages.push(
      `The following required field` +
        (duplicateRequiredFieldNames.length > 1 ? `s were` : ` was`) +
        ` defined more than once: "` +
        duplicateRequiredFieldNames.join(QUOTATION_JOIN) +
        `".`,
    );
  }
  if (invalidRequiredFieldNames.length > 0) {
    errorMessages.push(
      `The following required field` +
        (invalidRequiredFieldNames.length > 1 ? `s were` : ` was`) +
        ` not type "String!" with a minimum length of 1: "` +
        invalidRequiredFieldNames.join(QUOTATION_JOIN) +
        `".`,
    );
  }
  if (invalidFieldNames.length > 0) {
    errorMessages.push(
      `The following field` +
        (invalidFieldNames.length > 1 ? `s are` : ` is`) +
        ` not part of a valid "edfs__NatsStreamConfiguration" input definition: "` +
        invalidFieldNames.join(QUOTATION_JOIN) +
        `".`,
    );
  }
  message +=
    `\n However, the provided input was invalid for the following reason` +
    (errorMessages.length > 1 ? `s` : ``) +
    `:\n  ` +
    errorMessages.join(`\n  `);
  return message;
}

export function invalidKeyFieldSetsEventDrivenErrorMessage(
  invalidKeyFieldSetsByEntityTypeName = new Map<string, string[]>(),
): string {
  let message = '';
  for (const [typeName, keyFieldSets] of invalidKeyFieldSetsByEntityTypeName) {
    message +=
      ` The following "@key" field set` +
      (keyFieldSets.length > 1 ? 's are' : ' is') +
      ` defined on the entity "${typeName}" without a "resolvable: false" argument:\n` +
      `  "` +
      keyFieldSets.join(QUOTATION_JOIN) +
      `"\n`;
  }
  return message;
}

export function nonExternalKeyFieldNamesEventDrivenErrorMessage(
  nonExternalKeyFieldNameByFieldPath: Map<string, string>,
): string {
  let message =
    ` The following field` +
    (nonExternalKeyFieldNameByFieldPath.size > 1 ? 's are referenced' : ' is referenced') +
    ` within an entity "@key" field without an "@external" declaration:\n`;
  for (const [fieldPath, fieldName] of nonExternalKeyFieldNameByFieldPath) {
    message += `  field "${fieldName}" defined on path "${fieldPath}"\n`;
  }
  return message;
}

export function nonKeyFieldNamesEventDrivenErrorMessage(nonKeyFieldNameByFieldPath: Map<string, string>): string {
  let message =
    ` The following field` +
    (nonKeyFieldNameByFieldPath.size > 1 ? 's are' : ' is') +
    ` defined despite not composing part of a "@key" directive field set:\n`;
  for (const [fieldPath, fieldName] of nonKeyFieldNameByFieldPath) {
    message += `  Field "${fieldName}" defined on path "${fieldPath}"\n`;
  }
  return message;
}

export function nonEntityObjectExtensionsEventDrivenErrorMessage(typeNames: string[]): string {
  return (
    `Only root types and entities (objects that define one or more primary keys with the "@key" directive) may` +
    ` be defined as object extensions in an Event Driven graph.` +
    `\nConsequently, the following object extension` +
    ` definition` +
    (typeNames.length > 1 ? 's are' : ' is') +
    ` invalid:\n  "` +
    typeNames.join(QUOTATION_JOIN) +
    `"\n`
  );
}

export function nonKeyComposingObjectTypeNamesEventDrivenErrorMessage(typeNames: string[]): string {
  return (
    ` Only object definitions whose fields compose part of a "@key" directive's field set may be defined in an` +
    ` Event Driven graph. Consequently, the following object type definition` +
    (typeNames.length > 1 ? 's are' : ' is') +
    ` invalid:\n  "` +
    typeNames.join(QUOTATION_JOIN) +
    `"\n`
  );
}

export const invalidEdfsPublishResultObjectErrorMessage =
  ` The object "edfs__PublishResult" that was defined in the Event Driven graph is invalid and must instead have` +
  ` the following definition:\n  type edfs__PublishResult {\n   success: Boolean!\n  }`;

export const invalidNatsStreamConfigurationDefinitionErrorMessage =
  ` The input object "edfs__NatsStreamConfiguration" that was defined in the Event Driven graph is invalid and must` +
  ` instead have the following definition:\n  input edfs__NatsStreamConfiguration {\n   consumerInactiveThreshold: Int! = 30\n` +
  `   consumerName: String!\n   streamName: String!\n  }`;

export function invalidEdfsDirectiveName(directiveName: string): Error {
  return new Error(
    `Could not retrieve definition for Event-Driven Federated Subscription directive "${directiveName}".`,
  );
}

export function invalidImplementedTypeError(
  typeName: string,
  invalidImplementationTypeStringByTypeName: Map<string, string>,
): Error {
  let message =
    ` Only interfaces can be implemented. However, the type "${typeName}" attempts to implement` +
    ` the following invalid type` +
    (invalidImplementationTypeStringByTypeName.size > 1 ? `s` : ``) +
    `:\n`;
  for (const [typeName, typeString] of invalidImplementationTypeStringByTypeName) {
    message += `  "${typeName}", which is type "${typeString}"\n`;
  }
  return new Error(message);
}

export function selfImplementationError(typeName: string): Error {
  return new Error(` The interface "${typeName}" must not implement itself.`);
}

export function invalidEventSubjectErrorMessage(argumentName: string): string {
  return `The "${argumentName}" argument must be string with a minimum length of one.`;
}

export function invalidEventSubjectsErrorMessage(argumentName: string): string {
  return `The "${argumentName}" argument must be a list of strings.`;
}

export function invalidEventSubjectsItemErrorMessage(argumentName: string): string {
  return (
    `Each item in the "${argumentName}" argument list must be a string with a minimum length of one.` +
    ` However, at least one value provided in the list was invalid.`
  );
}

export function invalidEventSubjectsArgumentErrorMessage(argumentName: string): string {
  return `An argument template references the invalid argument "${argumentName}".`;
}

export function undefinedEventSubjectsArgumentErrorMessage(argumentName: string): string {
  return `An argument template references the undefined argument "${argumentName}".`;
}

export const invalidEventProviderIdErrorMessage = `If explicitly defined, the "providerId" argument must be a string with a minimum length of one.`;

export function invalidEventDirectiveError(directiveName: string, fieldPath: string, errorMessages: string[]): Error {
  return new Error(
    `The event directive "${directiveName}" declared on "${fieldPath}" is invalid for the following` +
      ` reason` +
      (errorMessages.length > 1 ? `s` : ``) +
      `:\n ` +
      errorMessages.join(`\n `),
  );
}

export function invalidReferencesOfInaccessibleTypeError(
  typeString: string,
  typeName: string,
  invalidPaths: string[],
): Error {
  return new Error(
    `The ${typeString} "${typeName}" is declared "@inaccessible"; however, the ${typeString} is still referenced at` +
      ` the following paths:\n "` +
      invalidPaths.join(QUOTATION_JOIN) +
      `"\n`,
  );
}

export function inaccessibleRequiredInputValueError(data: InputValueData, parentCoords: string): Error {
  return new Error(
    `The ${data.kind === Kind.ARGUMENT ? 'argument' : 'Input field'} "${data.name}" defined at coordinates` +
      ` "${data.federatedCoords}" is declared "@inaccessible";  however, it is a required` +
      ` ${data.kind === Kind.ARGUMENT ? 'argument of field' : 'field of Input Object'} "${parentCoords}".`,
  );
}

export function invalidUnionMemberTypeError(typeName: string, invalidMembers: string[]): Error {
  return new Error(
    ` The union "${typeName}" defines the following member` +
      (invalidMembers.length > 1 ? `s that are not object types` : ` that is not an object type`) +
      `:\n  ` +
      invalidMembers.join(`\n  `),
  );
}

export function invalidRootTypeError(typeName: string): Error {
  return new Error(
    `Expected type "${typeName}" to be a root type but could not find its respective OperationTypeNode.`,
  );
}

export function invalidSubscriptionFilterLocationError(path: string): Error {
  return new Error(
    `The "@${SUBSCRIPTION_FILTER}" directive must only be defined on a subscription root field, but it was` +
      ` defined on the path "${path}".`,
  );
}

export function invalidSubscriptionFilterDirectiveError(fieldPath: string, errorMessages: string[]): Error {
  return new Error(
    `The "@${SUBSCRIPTION_FILTER}" directive defined on path "${fieldPath}" is invalid for the` +
      ` following reason` +
      (errorMessages.length > 1 ? 's' : '') +
      `:\n` +
      errorMessages.join(`\n`),
  );
}

export function subscriptionFilterNamedTypeErrorMessage(namedTypeName: string): string {
  return ` Unknown type "${namedTypeName}".`;
}

export function subscriptionFilterConditionDepthExceededErrorMessage(inputPath: string): string {
  return (
    ` The input path "${inputPath}" exceeds the maximum depth of ${MAX_SUBSCRIPTION_FILTER_DEPTH}` +
    ` for any one filter condition.\n` +
    ` If you require a larger maximum depth, please contact support.`
  );
}

const subscriptionFilterConditionFieldsString =
  ` Each "${SUBSCRIPTION_FILTER_CONDITION}" input object must define exactly one of the following` +
  ` input value fields: "${AND_UPPER}", "${IN_UPPER}", "${NOT_UPPER}", or "${OR_UPPER}".\n`;

export function subscriptionFilterConditionInvalidInputFieldNumberErrorMessage(
  inputPath: string,
  fieldNumber: number,
): string {
  return subscriptionFilterConditionFieldsString + ` However, input path "${inputPath}" defines ${fieldNumber} fields.`;
}

export function subscriptionFilterConditionInvalidInputFieldErrorMessage(
  inputPath: string,
  invalidFieldName: string,
): string {
  return (
    subscriptionFilterConditionFieldsString +
    ` However, input path "${inputPath}" defines the invalid input value field "${invalidFieldName}".`
  );
}

export function subscriptionFilterConditionInvalidInputFieldTypeErrorMessage(
  inputPath: string,
  expectedTypeString: string,
  actualTypeString: string,
): string {
  return (
    ` Expected the value of input path "${inputPath}" to be type "${expectedTypeString}"` +
    ` but received type "${actualTypeString}"`
  );
}

const subscriptionFilterConditionArrayString =
  ` An AND or OR input field defined on a "${SUBSCRIPTION_FILTER_CONDITION}" should define a list of 1–5` +
  ` nested conditions.\n`;

export function subscriptionFilterArrayConditionInvalidItemTypeErrorMessage(
  inputPath: string,
  invalidIndices: number[],
): string {
  const isPlural = invalidIndices.length > 1;
  return (
    subscriptionFilterConditionArrayString +
    ` However, the following ` +
    (isPlural ? `indices` : 'index') +
    ` defined on input path "${inputPath}" ` +
    (isPlural ? `are` : `is`) +
    ` not type "object": ` +
    invalidIndices.join(`, `)
  );
}

export function subscriptionFilterArrayConditionInvalidLengthErrorMessage(
  inputPath: string,
  actualLength: number,
): string {
  return (
    subscriptionFilterConditionArrayString +
    ` However, the list defined on input path "${inputPath}" has a length of ${actualLength}.`
  );
}

export function invalidInputFieldTypeErrorMessage(
  inputPath: string,
  expectedTypeString: string,
  actualTypeString: string,
): string {
  return (
    ` Expected the input path "${inputPath}" to be type "${expectedTypeString}"` +
    ` but received "${actualTypeString}".`
  );
}

export function subscriptionFieldConditionInvalidInputFieldErrorMessage(
  inputPath: string,
  missingFieldNames: string[],
  duplicatedFieldNames: string[],
  invalidFieldNames: string[],
  fieldErrorMessages: string[],
): string {
  let message =
    ` Each "${SUBSCRIPTION_FIELD_CONDITION}" input object must only define the following two` +
    ` input value fields: "${FIELD_PATH}" and "${VALUES}".\n However, input path "${inputPath}" is invalid because:`;
  if (missingFieldNames.length > 0) {
    message +=
      `\n  The following required field` +
      (missingFieldNames.length > 1 ? `s are` : ` is`) +
      ` not defined:\n   "` +
      missingFieldNames.join(QUOTATION_JOIN) +
      `"`;
  }
  if (duplicatedFieldNames.length > 0) {
    message +=
      `\n  The following required field` +
      (duplicatedFieldNames.length > 1 ? `s are` : ` is`) +
      ` defined more than once:\n   "` +
      duplicatedFieldNames.join(QUOTATION_JOIN) +
      `"`;
  }
  if (invalidFieldNames.length > 0) {
    message +=
      `\n  The following invalid field` +
      (invalidFieldNames.length > 1 ? `s are` : ` is`) +
      ` defined:\n   "` +
      invalidFieldNames.join(QUOTATION_JOIN) +
      `"`;
  }
  if (fieldErrorMessages.length > 0) {
    message += `\n ` + fieldErrorMessages.join(`\n `);
  }
  return message;
}

const subscriptionFieldConditionValuesString =
  ` A "${SUBSCRIPTION_FIELD_CONDITION}" input object must define a "values" input value field` +
  ` with a list of at least one valid "${SUBSCRIPTION_FILTER_VALUE}" kind (boolean, enum, float, int, null, or string).\n`;

export function subscriptionFieldConditionInvalidValuesArrayErrorMessage(
  inputPath: string,
  invalidIndices: number[],
): string {
  const isPlural = invalidIndices.length > 1;
  return (
    subscriptionFieldConditionValuesString +
    ` However, the following ` +
    (isPlural ? 'indices' : 'index') +
    ` defined on input path "${inputPath}" ` +
    (isPlural ? `are` : `is`) +
    ` not a valid "${SUBSCRIPTION_FILTER_VALUE}": ` +
    invalidIndices.join(`, `)
  );
}

export function subscriptionFieldConditionEmptyValuesArrayErrorMessage(inputPath: string): string {
  return subscriptionFieldConditionValuesString + ` However, the list defined on input path "${inputPath}" is empty.`;
}

export function unknownFieldSubgraphNameError(fieldPath: string) {
  return new Error(` Field "${fieldPath}" defined no subgraph names.`);
}

export function invalidSubscriptionFieldConditionFieldPathErrorMessage(inputPath: string, conditionFieldPath: string) {
  return ` Input path "${inputPath}" defines the value "${conditionFieldPath}", which is not a period (.) delimited field path.`;
}

export function invalidSubscriptionFieldConditionFieldPathParentErrorMessage(
  inputPath: string,
  fullConditionFieldPath: string,
  partialConditionFieldPath: string,
) {
  return (
    ` Input path "${inputPath}" defines the value "${fullConditionFieldPath}".` +
    `\n However, "${partialConditionFieldPath}" is not type "object"`
  );
}

export function undefinedSubscriptionFieldConditionFieldPathFieldErrorMessage(
  inputPath: string,
  fullConditionFieldPath: string,
  partialConditionFieldPath: string,
  fieldName: string,
  parentTypeName: string,
) {
  return (
    ` Input path "${inputPath}" defines the value "${fullConditionFieldPath}".` +
    `\n However, the path "${partialConditionFieldPath}" is invalid because no field named "${fieldName}"` +
    ` exists on type "${parentTypeName}".`
  );
}

export function invalidSubscriptionFieldConditionFieldPathFieldErrorMessage(
  inputPath: string,
  fullConditionFieldPath: string,
  partialConditionFieldPath: string,
  fieldPath: string,
  subgraphName: string,
) {
  return (
    `Input path "${inputPath}" defines the value "${fullConditionFieldPath}".` +
    `\n However, only fields that are defined in the same graph as the "@${SUBSCRIPTION_FILTER}" directive` +
    ` can compose part of an "IN" condition's "fieldPath" input value field.` +
    `\n Consequently, the path "${partialConditionFieldPath}" is invalid because field "${fieldPath}"` +
    ` is not defined in subgraph "${subgraphName}".`
  );
}

export function inaccessibleSubscriptionFieldConditionFieldPathFieldErrorMessage(
  inputPath: string,
  fullConditionFieldPath: string,
  partialConditionFieldPath: string,
  fieldPath: string,
) {
  return (
    ` Input path "${inputPath}" defines the value "${fullConditionFieldPath}".` +
    `\n  The path segment "${partialConditionFieldPath}" is invalid because it refers to "${fieldPath}",` +
    ` which is declared "@inaccessible".`
  );
}

export function nonLeafSubscriptionFieldConditionFieldPathFinalFieldErrorMessage(
  inputPath: string,
  fullConditionFieldPath: string,
  fieldName: string,
  typeString: string,
  namedTypeName: string,
) {
  return (
    ` Input path "${inputPath}" defines the value "${fullConditionFieldPath}".` +
    `\n However, the final field "${fieldName}" is ${typeString} "${namedTypeName}", which is not a leaf type;` +
    ` therefore, it requires further selections.`
  );
}

export function unresolvablePathError(
  { fieldName, selectionSet }: UnresolvableFieldData,
  reasons: Array<string>,
): Error {
  const message =
    `The field "${fieldName}" is unresolvable at the following path:\n${selectionSet}` +
    `\nThis is because:\n - ` +
    reasons.join(`\n - `);
  return new Error(message);
}

export function allExternalFieldInstancesError(
  typeName: string,
  subgraphNamesByFieldName: Map<string, Array<string>>,
): Error {
  let message =
    `The Object "${typeName}" is invalid because the following field definition` +
    (subgraphNamesByFieldName.size > 1 ? 's are' : ' is') +
    ` declared "@external" on all instances of that field:\n`;
  for (const [fieldName, subgraphNames] of subgraphNamesByFieldName) {
    message +=
      ` "${fieldName}" in subgraph` +
      (subgraphNames.length > 1 ? 's' : '') +
      ` "` +
      subgraphNames.join(QUOTATION_JOIN) +
      `"\n`;
  }
  message += `At least one instance of a field definition must always be resolvable (and therefore not declared "@external").`;
  return new Error(message);
}

export function externalInterfaceFieldsError(typeName: string, fieldNames: Array<string>): Error {
  return new Error(
    `The interface "${typeName}" is invalid because the following field definition` +
      (fieldNames.length > 1 ? 's are' : ' is') +
      ` declared "@external":\n "` +
      fieldNames.join(QUOTATION_JOIN) +
      `"\n` +
      `Interface fields should not be declared "@external". This is because interface fields do not resolve directly,` +
      ` but the "@external" directive relates to whether a field instance can be resolved` +
      ` by the subgraph in which it is defined.`,
  );
}

export function nonExternalConditionalFieldError(
  directiveCoords: string,
  subgraphName: string,
  targetCoords: string,
  fieldSet: string,
  fieldSetDirectiveName: string,
): Error {
  return new Error(
    `The field "${directiveCoords}" in subgraph "${subgraphName}" defines a "@${fieldSetDirectiveName}"` +
      ` directive with the following field set:\n "${fieldSet}".` +
      `\nHowever, neither the field "${targetCoords}" nor any of its field set ancestors are declared "@external".` +
      `\nConsequently, "${targetCoords}" is already provided by subgraph "${subgraphName}" and should not form part of` +
      ` a "@${fieldSetDirectiveName}" directive field set.`,
  );
}

export function incompatibleFederatedFieldNamedTypeError(
  fieldCoordinates: string,
  subgraphNamesByNamedTypeName: Map<string, Set<string>>,
): Error {
  const instances: Array<string> = [];
  for (const [namedTypeName, subgraphNames] of subgraphNamesByNamedTypeName) {
    const names = [...subgraphNames];
    instances.push(
      ` The named type "${namedTypeName}" is returned by the following subgraph` +
        (names.length > 1 ? `s` : ``) +
        `: "` +
        names.join(QUOTATION_JOIN) +
        `".`,
    );
  }
  return new Error(
    `Each instance of a shared field must resolve identically across subgraphs.\n` +
      `The field "${fieldCoordinates}" could not be federated due to incompatible types across subgraphs.\n` +
      `The discrepancies are as follows:\n` +
      instances.join(`\n`),
  );
}

export function unknownNamedTypeErrorMessage(fieldCoordinates: string, namedTypeName: string): string {
  return `The field "${fieldCoordinates}" returns the unknown named type "${namedTypeName}".`;
}

export function unknownNamedTypeError(fieldCoordinates: string, namedTypeName: string): Error {
  return new Error(unknownNamedTypeErrorMessage(fieldCoordinates, namedTypeName));
}

export function unknownFieldDataError(fieldCoordinates: string): Error {
  return new Error(
    `Could not find FieldData for field "${fieldCoordinates}"\n.` +
      `This should never happen. Please report this issue on GitHub.`,
  );
}

export function unexpectedNonCompositeOutputTypeError(namedTypeName: string, actualTypeString: string): Error {
  return new Error(
    `Expected named type "${namedTypeName}" to be a composite output type (Object or Interface)` +
      ` but received "${actualTypeString}".\nThis should never happen. Please report this issue on GitHub.`,
  );
}

export function invalidExternalDirectiveError(fieldCoords: string): Error {
  return new Error(
    `The Object field "${fieldCoords}" is invalidly declared "@external". An Object field should only` +
      ` be declared "@external" if it is part of a "@key", "@provides", or "@requires" field set, or the field is` +
      ` necessary to satisfy an Interface implementation. In the case that none of these conditions is true, the` +
      ` "@external" directive should be removed.`,
  );
}

export function configureDescriptionNoDescriptionError(typeString: string, typeName: string): Error {
  return new Error(
    `The "@openfed__configureDescription" directive defined on ${typeString} "${typeName}" is invalid` +
      ` because neither a description nor the "descriptionOverride" argument is defined.`,
  );
}

export function configureDescriptionPropagationError(coords: string, subgraphNames: Array<string>): Error {
  return new Error(
    `The coordinates "${coords}" declare "@openfed__configureDescription(propagate: true)" in the following subgraphs:\n "` +
      subgraphNames.join(QUOTATION_JOIN) +
      '"\n' +
      `A federated graph only supports a single description; consequently, only one subgraph may define argument "propagate" as true (this is the default value).`,
  );
}

export function duplicateDirectiveDefinitionArgumentErrorMessage(argumentNames: Array<string>): string {
  return (
    `- The following argument` +
    (argumentNames.length > 1 ? 's are' : ' is') +
    ' defined more than once:\n "' +
    argumentNames.join(QUOTATION_JOIN) +
    '"'
  );
}

export function duplicateDirectiveDefinitionLocationErrorMessage(locationName: string): string {
  return `- The location "${locationName}" is defined multiple times.`;
}

export function invalidDirectiveDefinitionLocationErrorMessage(locationName: string): string {
  return `- "${locationName}" is not a valid directive location.`;
}

export function invalidDirectiveDefinitionError(directiveName: string, errorMessages: Array<string>): Error {
  return new Error(
    `The directive definition for "@${directiveName}" is invalid for the following reason` +
      (errorMessages.length > 1 ? 's' : '') +
      ':\n' +
      errorMessages.join(LITERAL_NEW_LINE) +
      '"',
  );
}

export function fieldAlreadyProvidedErrorMessage(
  fieldCoords: string,
  subgraphName: string,
  directiveName: string,
): string {
  return (
    ` The field "${fieldCoords}" is unconditionally provided by subgraph "${subgraphName}" and should not form` +
    ` part of any "@${directiveName}" field set. Although "${fieldCoords}" is declared "@external", it is part of` +
    ` a "@key" directive on an extension type. Such fields are only declared "@external" for legacy syntactical` +
    ` reasons and are not internally considered "@external".`
  );
}

export function invalidInterfaceObjectImplementationDefinitionsError(
  typeName: string,
  subgraphName: string,
  implementationTypeNames: Array<string>,
): Error {
  return new Error(
    `The subgraph that defines an entity Interface Object (using "@interfaceObject") must not define any ` +
      ` implementation types of that interface. However, the subgraph "${subgraphName}" defines the entity Interface` +
      ` "${typeName}" as an Interface Object alongside the following implementation type` +
      (implementationTypeNames.length > 1 ? `s` : ``) +
      ` of "${typeName}":\n "` +
      implementationTypeNames.join(QUOTATION_JOIN) +
      `"`,
  );
}

export function invalidNamedTypeError({ data, namedTypeData, nodeType }: InvalidNamedTypeErrorParams): Error {
  const isOutputField = isFieldData(data);
  const coords = isOutputField ? `${data.originalParentTypeName}.${data.name}` : data.originalCoords;
  return new Error(
    `The ${nodeType} "${coords}" is invalid because it defines type ` +
      printTypeNode(data.type) +
      `; however, ${kindToNodeType(namedTypeData.kind)} "${namedTypeData.name}" is not a valid ` +
      (isOutputField ? 'output' : 'input') +
      ' type.',
  );
}

export function semanticNonNullLevelsNaNIndexErrorMessage(value: string) {
  return `Index "${value}" is not a valid integer.`;
}

export function semanticNonNullLevelsIndexOutOfBoundsErrorMessage({
  maxIndex,
  typeString,
  value,
}: SemanticNonNullLevelsIndexOutOfBoundsErrorParams) {
  return (
    `Index "${value}" is out of bounds for type ${typeString}; ` +
    (maxIndex > 0 ? `valid indices are 0-${maxIndex} inclusive.` : `the only valid index is 0.`)
  );
}

export function semanticNonNullLevelsNonNullErrorMessage({
  typeString,
  value,
}: SemanticNonNullLevelsNonNullErrorParams) {
  return `Index "${value}" of type ${typeString} is non-null but must be nullable.`;
}

export const semanticNonNullArgumentErrorMessage = `Argument "${LEVELS}" validation error.`;

export function semanticNonNullInconsistentLevelsError(data: FieldData): Error {
  const coords = `${data.renamedParentTypeName}.${data.name}`;
  let message =
    `The "@semanticNonNull" directive defined on field "${coords}"` +
    ` is invalid due to inconsistent values provided to the "levels" argument across the following subgraphs:\n`;
  for (const [subgraphName, levels] of data.nullLevelsBySubgraphName) {
    message += ` Subgraph "${subgraphName}" defines levels ${Array.from(levels).sort((a, b) => a - b)}.\n`;
  }
  message +=
    `The list value provided to the "levels" argument must be consistently defined across all subgraphs that` +
    ` define "@semanticNonNull" on field "${coords}".`;
  return new Error(message);
}

export function oneOfRequiredFieldsError({ requiredFieldNames, typeName }: OneOfRequiredFieldsErrorParams): Error {
  return new Error(
    `The "@oneOf" directive defined on Input Object "${typeName}" is invalid because all Input fields must be` +
      ` optional (nullable); however, the following Input field` +
      (requiredFieldNames.length > 1 ? `s are` : ` is`) +
      ` required (non-nullable): "` +
      requiredFieldNames.join(QUOTATION_JOIN) +
      `".`,
  );
}
