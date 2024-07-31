import { nodeKindToDirectiveLocation } from '../ast/utils';
import {
  ConstDirectiveNode,
  Kind,
  OperationTypeNode,
  SchemaExtensionNode,
  TypeDefinitionNode,
  TypeExtensionNode,
} from 'graphql';
import {
  EntityInterfaceFederationData,
  getEntriesNotInHashSet,
  getOrThrowError,
  GraphFieldData,
  ImplementationErrors,
  InvalidArgument,
  InvalidEntityInterface,
  InvalidRequiredInputValueData,
  kindToTypeString,
  numberToOrdinal,
} from '../utils/utils';
import { RootTypeFieldData } from '../federation/utils';
import {
  AND_UPPER,
  ARGUMENT,
  FIELD_PATH,
  IN_UPPER,
  INPUT_FIELD,
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
import { ObjectDefinitionData } from '../schema-building/type-definition-data';
import { InvalidRootTypeFieldEventsDirectiveData } from './utils';
import { MAX_SUBSCRIPTION_FILTER_DEPTH, MAXIMUM_TYPE_NESTING } from '../utils/integer-constants';
import { UnresolvableFieldData } from '../resolvability-graph/utils';

export const minimumSubgraphRequirementError = new Error('At least one subgraph is required for federation.');

export function incompatibleExtensionError(typeName: string, baseKind: Kind, extensionKind: Kind) {
  return new Error(
    `Extension error:\n Incompatible types: ` +
      `"${typeName}" is type "${baseKind}", but an extension of the same name is type "${extensionKind}.`,
  );
}

export function incompatibleArgumentTypesError(
  argName: string,
  hostPath: string,
  expectedType: string,
  actualType: string,
): Error {
  return new Error(
    `Incompatible types when merging two instances of argument "${argName}" on path "${hostPath}":\n` +
      ` Expected type "${expectedType}" but received "${actualType}"`,
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

export function incompatibleChildTypesError(childPath: string, expectedType: string, actualType: string): Error {
  return new Error(
    `Incompatible types when merging two instances of "${childPath}":\n` +
      ` Expected type "${expectedType}" but received "${actualType}"`,
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

// The @extends directive means a TypeDefinitionNode is possible
export function incompatibleExtensionKindsError(
  node: TypeDefinitionNode | TypeExtensionNode | SchemaExtensionNode,
  existingKind: Kind,
) {
  const name = node.kind === Kind.SCHEMA_EXTENSION ? 'schema' : node.name.value;
  return new Error(`Expected extension "${name}" to be type ${existingKind} but received ${node.kind}.`);
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

export function duplicateFieldDefinitionError(fieldName: string, typeName: string): Error {
  return new Error(`Extension error:\n Field "${fieldName}" already exists on type "${typeName}".`);
}

export function duplicateDirectiveDefinitionError(directiveName: string) {
  return new Error(`The directive "${directiveName}" has already been defined.`);
}

export function duplicateEnumValueDefinitionError(valueName: string, typeName: string): Error {
  return new Error(`Extension error:\n Value "${valueName}" already exists on enum "${typeName}".`);
}

export function duplicateInterfaceExtensionError(interfaceName: string, typeName: string): Error {
  return new Error(`Extension error:\n Interface "${interfaceName}" is already implemented by type "${typeName}".`);
}

export function duplicateInterfaceError(interfaceName: string, typeName: string): Error {
  return new Error(`Interface "${interfaceName}" can only be defined on type "${typeName}" once.`);
}

export function duplicateUnionMemberExtensionError(memberName: string, typeName: string): Error {
  return new Error(`Extension error:\n Member "${memberName}" already exists on union "${typeName}".`);
}

export function duplicateValueExtensionError(parentType: string, typeName: string, childName: string) {
  return new Error(
    `Extension error:\n` +
      ` More than one extension attempts to extend ${parentType} "${typeName}" with the value "${childName}".`,
  );
}

export function duplicateTypeDefinitionError(type: string, typeName: string): Error {
  return new Error(`The ${type} "${typeName}" can only be defined once.`);
}

export function duplicateOperationTypeDefinitionError(
  operationTypeName: OperationTypeNode,
  newTypeName: string,
  oldTypeName: string,
): Error {
  return new Error(
    `The operation type "${operationTypeName}" cannot be defined as "${newTypeName}" because it has already been defined as "${oldTypeName}".`,
  );
}

export function noBaseTypeExtensionError(typeName: string): Error {
  return new Error(`Extension error:\n Could not extend the type "${typeName}" because no base definition exists.`);
}

export function noDefinedUnionMembersError(unionTypeName: string, extension = false): Error {
  return new Error(
    `The union ` + (extension ? 'extension' : '') + ` "${unionTypeName}" must define at least one union member.`,
  );
}

export function operationDefinitionError(typeName: string, operationType: OperationTypeNode, actualType: Kind): Error {
  return new Error(
    `Expected the response type "${typeName}" for operation "${operationType}" to be type object but received "${actualType}.`,
  );
}

export function invalidFieldShareabilityError(objectData: ObjectDefinitionData, invalidFieldNames: Set<string>): Error {
  const parentTypeName = objectData.name;
  const errorMessages: string[] = [];
  for (const [fieldName, fieldData] of objectData.fieldDataByFieldName) {
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
    `The object "${parentTypeName}" defines the same fields in multiple subgraphs without the "@shareable" directive:` +
      `${errorMessages.join('\n')}`,
  );
}

export function undefinedDirectiveErrorMessage(directiveName: string, hostPath: string): string {
  return (
    `The directive "${directiveName}" is declared on "${hostPath}",` +
    ` but the directive is not defined in the schema.`
  );
}

export function unresolvableFieldError(
  rootTypeFieldData: RootTypeFieldData,
  fieldName: string,
  fieldSubgraphs: string[],
  unresolvablePath: string,
  parentTypeName: string,
): Error {
  const fieldPath = `${parentTypeName}.${fieldName}`;
  return new Error(
    `The path "${unresolvablePath}" cannot be resolved because:\n` +
      ` The root type field "${rootTypeFieldData.path}" is defined in the following subgraph` +
      (rootTypeFieldData.subgraphs.size > 1 ? 's' : '') +
      `: "` +
      [...rootTypeFieldData.subgraphs].join(QUOTATION_JOIN) +
      `".\n` +
      ` However, "${fieldPath}" is only defined in the following subgraph` +
      (fieldSubgraphs.length > 1 ? 's' : '') +
      `: "` +
      fieldSubgraphs +
      `".\n` +
      ` Consequently, "${fieldPath}" cannot be resolved through the root type field "${rootTypeFieldData.path}".\n` +
      `Potential solutions:\n` +
      ` Convert "${parentTypeName}" into an entity using the "@key" directive.\n` +
      ` Add the shareable root type field "${rootTypeFieldData.path}" to ` +
      (fieldSubgraphs.length > 1 ? 'one of the following subgraphs' : 'the following subgraph') +
      `: "` +
      fieldSubgraphs.join(QUOTATION_JOIN) +
      `".\n` +
      `  For example (note that V1 fields are shareable by default and do not require a directive):\n` +
      `   type ${rootTypeFieldData.typeName} {\n` +
      `     ...\n` +
      `     ${rootTypeFieldData.fieldName}: ${rootTypeFieldData.fieldTypeNodeString} @shareable\n` +
      `   }`,
  );
}

export function undefinedTypeError(typeName: string): Error {
  return new Error(` The type "${typeName}" was referenced in the schema, but it was never defined.`);
}

export function invalidRepeatedDirectiveErrorMessage(directiveName: string, hostPath: string): string {
  return (
    `The definition for the directive "${directiveName}" does not define it as repeatable, ` +
    `but the same directive is declared more than once on type "${hostPath}".`
  );
}

export function invalidRepeatedFederatedDirectiveErrorMessage(directiveName: string, hostPath: string): Error {
  return new Error(
    `The definition for the directive "${directiveName}" does not define it as repeatable,` +
      ` but the directive has been declared on more than one instance of the type "${hostPath}".`,
  );
}

export function duplicateUnionMemberError(memberTypeName: string, unionTypeName: string): Error {
  return new Error(`Member "${memberTypeName}" must only be defined on union "${unionTypeName}" once.`);
}

export function invalidDirectiveError(directiveName: string, hostPath: string, errorMessages: string[]): Error {
  return new Error(
    `The directive "${directiveName}" declared on "${hostPath}" is invalid for the following reason` +
      (errorMessages.length > 1 ? 's:\n' : ':\n') +
      errorMessages.join('\n'),
  );
}

export function invalidDirectiveLocationErrorMessage(hostPath: string, kind: Kind, directiveName: string): string {
  return (
    ` "${hostPath}" is type "${kind}", but the directive "${directiveName}" ` +
    `does not define "${nodeKindToDirectiveLocation(kind)}" as a valid location.`
  );
}

export function unexpectedDirectiveArgumentsErrorMessage(directive: ConstDirectiveNode, hostPath: string): string {
  const directiveName = directive.name.value;
  const argumentNumber = directive.arguments?.length || 1; // should never be less than 1
  return (
    ` The definition for the directive "${directiveName}" does not define any arguments.\n` +
    ` However, the same directive declared on "${hostPath}" defines ${argumentNumber} argument` +
    (argumentNumber > 1 ? 's.' : '.')
  );
}

export function undefinedRequiredArgumentsErrorMessage(
  directiveName: string,
  hostPath: string,
  requiredArguments: string[],
  missingRequiredArguments: string[] = [],
): string {
  let message =
    ` The definition for the directive "${directiveName}" defines the following ` +
    requiredArguments.length +
    ` required argument` +
    (requiredArguments.length > 1 ? 's: ' : ': ') +
    `"` +
    requiredArguments.join('", "') +
    `"` +
    `.\n However, the same directive that is declared on "${hostPath}" does not define`;
  if (missingRequiredArguments.length < 1) {
    return message + ` any arguments.`;
  }
  return (
    message +
    ` the following required argument` +
    (missingRequiredArguments.length > 1 ? `s` : ``) +
    `: "` +
    missingRequiredArguments.join(QUOTATION_JOIN) +
    `".`
  );
}

export function unexpectedDirectiveArgumentErrorMessage(directiveName: string, argumentNames: string[]): string {
  return (
    ` The definition for the directive "${directiveName}" does not define the following provided argument` +
    (argumentNames.length > 1 ? 's' : '') +
    `: "` +
    argumentNames.join(QUOTATION_JOIN) +
    `".`
  );
}

export function duplicateDirectiveArgumentDefinitionsErrorMessage(
  directiveName: string,
  hostPath: string,
  argumentNames: string[],
): string {
  return (
    ` The directive "${directiveName}" that is declared on "${hostPath}" defines the following argument` +
    (argumentNames.length > 1 ? 's' : '') +
    ` more than once: "` +
    argumentNames.join(QUOTATION_JOIN) +
    `"`
  );
}

export function invalidDirectiveArgumentTypeErrorMessage(
  required: boolean,
  argumentName: string,
  expectedKind: Kind,
  actualKind: Kind,
): string {
  return (
    ` The ${required ? 'required ' : ''}argument "${argumentName} must be type` +
    ` "${expectedKind}" and not type "${actualKind}".`
  );
}

export function invalidKeyDirectiveArgumentErrorMessage(directiveKind: Kind): string {
  return ` The required argument named "fields" must be type "String" and not type "${directiveKind}".`;
}

export function invalidKeyDirectivesError(parentTypeName: string, errorMessages: string[]): Error {
  return new Error(
    `The entity "${parentTypeName}" defines the following invalid "key" directive` +
      (errorMessages.length > 1 ? 's' : '') +
      `:\n` +
      errorMessages.join('\n'),
  );
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
    `Fatal: Expected "${parentTypeName}" to be type ${kindToTypeString(expectedKind)}` +
      ` but received "${kindToTypeString(actualKind)}".`,
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
    ` When merging types, expected "${parentTypeName}" to be type ${expectedTypeString} but received "${actualTypeString}".`,
  );
}

export function incompatibleObjectExtensionOrphanBaseTypeError(
  parentTypeName: string,
  actualTypeString: string,
): Error {
  return new Error(
    ` When merging the object extension orphan "${parentTypeName}", expected an existing object base type` +
      ` but received "${actualTypeString}".`,
  );
}

export function fieldTypeMergeFatalError(fieldName: string) {
  return new Error(
    `Fatal: Unsuccessfully merged the cross-subgraph types of field "${fieldName}"` +
      ` without producing a type error object.`,
  );
}

export function unexpectedDirectiveLocationError(locationName: string): Error {
  return new Error(`Fatal: Unknown directive location "${locationName}".`);
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

export function invalidConfigurationResultFatalError(fieldPath: string): Error {
  return new Error(`Fatal: Expected either errors or configurations for the path ${fieldPath}" but received neither".`);
}

export const subgraphValidationFailureError: Error = new Error(
  ` Fatal: Subgraph validation did not return a valid AST.`,
);

export const federationFactoryInitializationFatalError = new Error(
  'Fatal: FederationFactory was unsuccessfully initialized.',
);

export function unexpectedParentKindErrorMessage(
  parentTypeName: string,
  expectedTypeString: string,
  actualTypeString: string,
): string {
  return ` Expected "${parentTypeName}" to be type ${expectedTypeString} but received "${actualTypeString}".`;
}

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
  parentTypeName: string,
  parentTypeString: string,
  implementationErrorsByInterfaceTypeName: Map<string, ImplementationErrors>,
): Error {
  const messages: string[] = [];
  for (const [interfaceName, implementationErrors] of implementationErrorsByInterfaceTypeName) {
    let message =
      ` The implementation of interface "${interfaceName}" by "${parentTypeName}"` + ` is invalid because:\n`;
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
          `   If a field from an interface is implemented, any additional arguments that were not defined` +
          ` on the original interface field must be optional (nullable).\n`;
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
          ` a valid subset (equally or more restrictive) of the response type "` +
          invalidFieldImplementation.originalResponseType +
          `" for "${interfaceName}.${fieldName}".\n`;
      }
      if (invalidFieldImplementation.isInaccessible) {
        message +=
          `   The field has been declared @inaccessible; however, the same field has not been declared @inaccessible` +
          ` on the interface definition.\n   Consequently, the interface implementation cannot be satisfied.\n`;
      }
    }
    messages.push(message);
  }
  return new Error(
    `The ${parentTypeString} "${parentTypeName}" has the following interface implementation errors:\n` +
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

export function invalidArgumentsError(fieldPath: string, invalidArguments: InvalidArgument[]): Error {
  let message =
    `The field "${fieldPath}" is invalid because:\n` +
    ` The named type (root type) of an input must be on of Enum, Input Object, or Scalar type.` +
    ` For example: "Float", "[[String!]]!", or "[SomeInputObjectName]"\n`;
  for (const invalidArgument of invalidArguments) {
    message +=
      `  The argument "${invalidArgument.argumentName}" defines type "${invalidArgument.typeName}"` +
      ` but the named type "${invalidArgument.namedType}" is type "` +
      invalidArgument.typeString +
      `", which is not a valid input type.\n`;
  }
  return new Error(message);
}

export const noQueryRootTypeError = new Error(
  `A valid federated graph must have at least one accessible query root type field.\n` +
    ` For example:\n` +
    `  type Query {\n` +
    `    dummy: String\n` +
    `  }`,
);

export const inaccessibleQueryRootTypeError = new Error(
  `The root query type "Query" must be present in the client schema;` +
    ` consequently, it must not be declared @inaccessible.`,
);

export function unexpectedObjectResponseType(fieldPath: string, actualTypeString: string): Error {
  return new Error(
    `Expected the path "${fieldPath}" to have the response type` +
      ` Enum, Interface, Object, Scalar, or Union but received ${actualTypeString}.`,
  );
}

export function noConcreteTypesForAbstractTypeError(typeString: string, abstractTypeName: string): Error {
  return new Error(
    `Expected ${typeString} "${abstractTypeName}" to define at least one ` +
      (typeString === UNION ? 'member' : 'object that implements the interface') +
      ` but received none`,
  );
}

export function expectedEntityError(typeName: string): Error {
  return new Error(`Expected object "${typeName}" to define a "key" directive, but it defines no directives.`);
}

export const inlineFragmentInFieldSetErrorMessage = ` Inline fragments are not currently supported within a FieldSet argument.`;

export function abstractTypeInKeyFieldSetErrorMessage(
  fieldSet: string,
  fieldPath: string,
  abstractTypeName: string,
  abstractTypeString: string,
): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" returns "${abstractTypeName}", which is type "${abstractTypeString}".\n` +
    `  Fields that return abstract types (interfaces and unions)` +
    ` cannot be included in the FieldSet of "@key" directives.`
  );
}

export function unknownTypeInFieldSetErrorMessage(
  fieldSet: string,
  fieldPath: string,
  responseTypeName: string,
): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" returns the unknown type "${responseTypeName}".`
  );
}

export function invalidSelectionSetErrorMessage(
  fieldSet: string,
  fieldPath: string,
  fieldTypeName: string,
  fieldTypeString: string,
): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" returns "${fieldTypeName}", which is type "${fieldTypeString}".\n` +
    ` Types such as "${fieldTypeString}" that define fields` +
    ` must define a selection set with at least one field selection.`
  );
}

export function invalidSelectionSetDefinitionErrorMessage(
  fieldSet: string,
  fieldPath: string,
  fieldTypeName: string,
  fieldTypeString: string,
): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" returns "${fieldTypeName}", which is type "${fieldTypeString}".\n` +
    `  Types such as "${fieldTypeString}" that do not define fields cannot define a selection set.`
  );
}

export function undefinedFieldInFieldSetErrorMessage(
  fieldSet: string,
  parentTypeName: string,
  fieldName: string,
): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${parentTypeName}" does not define a field named "${fieldName}".`
  );
}

export function unparsableFieldSetErrorMessage(fieldSet: string, error?: Error): string {
  let message = ` The following FieldSet is invalid:\n "${fieldSet}"\n` + `  The FieldSet could not be parsed.`;
  if (error) {
    message += `\n The reason provided was: ` + error.message;
  }
  return message;
}

export function unparsableFieldSetSelectionErrorMessage(fieldSet: string, fieldName: string): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because the selection set defined on "${fieldName}" could not be parsed.`
  );
}

export function undefinedObjectLikeParentError(parentTypeName: string): Error {
  return new Error(` Expected an object/interface or object/interface extension named "${parentTypeName}" to exist.`);
}

export function unexpectedArgumentErrorMessage(fieldSet: string, fieldPath: string, argumentName: string): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" does not define an argument named "${argumentName}".`
  );
}

export function argumentsInKeyFieldSetErrorMessage(fieldSet: string, fieldPath: string): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" defines arguments.\n` +
    `  Fields that define arguments cannot be included in the FieldSet of @key directives.`
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
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" was included in the FieldSet more than once.`
  );
}

export function invalidConfigurationDataErrorMessage(typeName: string, fieldName: string, fieldSet: string): string {
  return (
    ` Expected ConfigurationData to exist for type "${typeName}" when adding field "${fieldName}"` +
    `  while validating FieldSet "${fieldSet}".`
  );
}

export function unknownProvidedObjectErrorMessage(fieldPath: string, responseType: string): string {
  return (
    ` A @provides directive is declared on "${fieldPath}".\n` +
    ` However, the response type "${responseType}" object or object extension definition was not found.`
  );
}

export function invalidInlineFragmentTypeErrorMessage(
  fieldSet: string,
  fieldPath: string,
  typeConditionName: string,
  parentTypeName: string,
): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" defines an inline fragment with the type condition "${typeConditionName}".\n` +
    `  However, "${parentTypeName}" is not an abstract (interface or union) type.\n` +
    `  Consequently, the only valid type condition would be "${parentTypeName}".`
  );
}

export function inlineFragmentWithoutTypeConditionErrorMessage(fieldSet: string, fieldPath: string): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" defines an inline fragment without a type condition.`
  );
}

export function unknownInlineFragmentTypeConditionErrorMessage(
  fieldSet: string,
  fieldPath: string,
  typeConditionName: string,
): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" defines an inline fragment` +
    ` with the unknown type condition "${typeConditionName}".`
  );
}

export function invalidInlineFragmentTypeConditionTypeErrorMessage(
  fieldSet: string,
  fieldPath: string,
  typeConditionName: string,
  typeConditionTypeString: string,
): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" defines an inline fragment with the type condition "${typeConditionName}",` +
    ` which is type "${typeConditionTypeString}".\n` +
    `  However, either an "interface" or "object" type was expected.`
  );
}

export function invalidInlineFragmentTypeConditionErrorMessage(
  fieldSet: string,
  fieldPath: string,
  typeConditionName: string,
  parentTypeString: string,
  parentTypeName: string,
): string {
  let message =
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" defines an inline fragment with the type condition "${typeConditionName}".\n`;
  if (parentTypeString === 'interface') {
    return message + `  However, "${typeConditionName}" does not implement "${parentTypeName}"`;
  }
  return message + `  However, "${typeConditionName}" is not a member of the union "${parentTypeName}".`;
}

export function invalidSelectionOnUnionErrorMessage(
  fieldSet: string,
  fieldPath: string,
  responseTypeName: string,
): string {
  return (
    ` The following FieldSet is invalid:\n "${fieldSet}"\n` +
    `  This is because "${fieldPath}" returns "${responseTypeName}", which is type "union".\n` +
    `  Consequently, an inline fragment is required to make a selection on one of the union's members.`
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
    `The @override directive must only be declared on one single instance of a field.` +
      ` However, an @override directive was declared on more than one instance of the following field` +
      (errorMessages.length > 1 ? 's' : '') +
      `: "` +
      errorMessages.join(QUOTATION_JOIN) +
      `".\n`,
  );
}

export function noFieldDefinitionsError(typeString: string, typeName: string): Error {
  return new Error(`The ${typeString} "${typeName}" is invalid because it does not define any fields.`);
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
    `Federation was unsuccessful because any one subgraph that defines a specific entity interface` +
    ` must also define each and every entity object that implements that entity interface.\n`;
  for (const [typeName, undefinedImplementations] of invalidEntityInterfacesByTypeName) {
    const entityInterfaceDatas = getOrThrowError(
      entityInterfaceFederationDataByTypeName,
      typeName,
      'entityInterfaceFederationDataByTypeName',
    );
    const implementedConcreteTypeNames = entityInterfaceDatas.concreteTypeNames!;
    message +=
      ` Across all subgraphs, the entity interface "${typeName}" is implemented by the following entity object` +
      (implementedConcreteTypeNames.size > 1 ? `s` : ``) +
      `:\n  "` +
      Array.from(implementedConcreteTypeNames).join(QUOTATION_JOIN) +
      `"\n` +
      ` However, the definition of at least one of these implementations is missing in a subgraph that` +
      ` defines the entity interface "${typeName}":\n`;
    for (const { subgraphName, concreteTypeNames } of undefinedImplementations) {
      const disparities = getEntriesNotInHashSet(implementedConcreteTypeNames, concreteTypeNames);
      message +=
        `  Subgraph "${subgraphName}" does not define the following implementations: "` +
        disparities.join(QUOTATION_JOIN) +
        `"\n`;
    }
  }
  return new Error(message);
}

export function orScopesLimitError(maxOrScopes: number, hostPaths: string[]): Error {
  return new Error(
    `The maximum number of OR scopes that can be defined by @requiresScopes on a single field is ${maxOrScopes}.` +
      ` However, the following path` +
      (hostPaths.length > 1 ? 's attempt' : ' attempts') +
      ` to define more:\n "` +
      hostPaths.join(QUOTATION_JOIN) +
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
  `  input edfs__NatsStreamConfiguration {\n    consumerName: String!\n    streamName: String!\n  }`;

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
      ` The following "@key" FieldSet` +
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
    (nonExternalKeyFieldNameByFieldPath.size > 1 ? 's' : '') +
    ` compose part of an entity's primary key but are not declared "@external":\n`;
  for (const [fieldPath, fieldName] of nonExternalKeyFieldNameByFieldPath) {
    message += `  field "${fieldName}" defined on path "${fieldPath}"\n`;
  }
  return message;
}

export function nonKeyFieldNamesEventDrivenErrorMessage(nonKeyFieldNameByFieldPath: Map<string, string>): string {
  let message =
    ` The following field` +
    (nonKeyFieldNameByFieldPath.size > 1 ? 's are' : ' is') +
    ` defined despite not composing part of a "@key" directive FieldSet:\n`;
  for (const [fieldPath, fieldName] of nonKeyFieldNameByFieldPath) {
    message += `  Field "${fieldName}" defined on path "${fieldPath}"\n`;
  }
  return message;
}

export function nonEntityObjectExtensionsEventDrivenErrorMessage(typeNames: string[]): string {
  return (
    ` Only root types and entities (objects that define one or more primary keys with the "@key" directive) may` +
    ` be defined as object extensions in an Event Driven graph. Consequently, the following object extension` +
    ` definition` +
    (typeNames.length > 1 ? 's are' : ' is') +
    ` invalid:\n  "` +
    typeNames.join(QUOTATION_JOIN) +
    `"\n`
  );
}

export function nonKeyComposingObjectTypeNamesEventDrivenErrorMessage(typeNames: string[]): string {
  return (
    ` Only object definitions whose fields compose part of a "@key" directive's FieldSet may be defined in an` +
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

export const undefinedNatsStreamConfigurationInputErrorMessage =
  ` The input object "edfs__NatsStreamConfiguration" must be defined in the event-driven graph to satisfy the` +
  ` "@edfs__natsSubscribe" directive.\n The following input must be defined in the event-driven graph:\n` +
  `  input edfs__NatsStreamConfiguration {\n   consumerName: String!\n   streamName: String!\n  }`;

export const invalidNatsStreamConfigurationDefinitionErrorMessage =
  ` The input object "edfs__NatsStreamConfiguration" that was defined in the Event Driven graph is invalid and must` +
  ` instead have the following definition:\n  input edfs__NatsStreamConfiguration {\n` +
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
    `The ${typeString} "${typeName}" is declared @inaccessible; however, the ${typeString} is still referenced at` +
      ` the following paths:\n "` +
      invalidPaths.join(QUOTATION_JOIN) +
      `"\n`,
  );
}

export function inaccessibleRequiredArgumentError(
  argumentName: string,
  argumentPath: string,
  fieldName: string,
): Error {
  return new Error(
    `The argument "${argumentName}" on path "${argumentPath}" is declared @inaccessible;` +
      ` however, it is a required argument for field "${fieldName}".`,
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
    ` which is declared @inaccessible.`
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
