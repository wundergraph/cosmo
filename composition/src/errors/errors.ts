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
  ImplementationErrorsMap,
  InvalidArgument,
  InvalidRequiredArgument,
  kindToTypeString,
  numberToOrdinal,
} from '../utils/utils';
import { ObjectContainer, RootTypeFieldData } from '../federation/utils';
import { QUOTATION_JOIN, UNION } from '../utils/string-constants';

export const minimumSubgraphRequirementError = new Error('At least one subgraph is required for federation.');

export function incompatibleExtensionError(typeName: string, baseKind: Kind, extensionKind: Kind) {
  return new Error(
    `Extension error:\n Incompatible types: ` +
    `"${typeName}" is type "${baseKind}", but an extension of the same name is type "${extensionKind}.`,
  );
}

export function incompatibleArgumentTypesError(
  argName: string,
  parentName: string,
  childName: string,
  expectedType: string,
  actualType: string,
): Error {
  return new Error(
    `Incompatible types when merging two instances of argument "${argName}" for "${parentName}.${childName}":\n` +
    ` Expected type "${expectedType}" but received "${actualType}"`,
  );
}

export function incompatibleChildTypesError(
  parentName: string,
  childName: string,
  expectedType: string,
  actualType: string,
): Error {
  return new Error(
    `Incompatible types when merging two instances of "${parentName}.${childName}":\n` +
    ` Expected type "${expectedType}" but received "${actualType}"`,
  );
}

export function incompatibleArgumentDefaultValueError(
  argName: string,
  parentName: string,
  childName: string,
  expectedValue: string | boolean,
  actualValue: string | boolean,
): Error {
  return new Error(
    `Incompatible default values when merging two instances of argument "${argName} for "${parentName}.${childName}":\n` +
    ` Expected value "${expectedValue}" but received "${actualValue}"`,
  );
}

export function incompatibleArgumentDefaultValueTypeError(
  argName: string,
  parentName: string,
  childName: string,
  expectedType: Kind,
  actualType: Kind,
): Error {
  return new Error(
    `Incompatible default values when merging two instances of argument "${argName} for "${parentName}.${childName}":\n` +
    ` Expected type "${expectedType}" but received "${actualType}"`,
  );
}

export function incompatibleSharedEnumError(parentName: string): Error {
  return new Error(
    `Enum "${parentName}" was used as both an input and output but was inconsistently defined across inclusive subgraphs.`,
  );
}

// The @extends directive means a TypeDefinitionNode is possible
export function incompatibleExtensionKindsError(
  node: TypeDefinitionNode | TypeExtensionNode | SchemaExtensionNode, existingKind: Kind
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
  return new Error(`Extension error:\n Field "${fieldName} already exists on type "${typeName}".`);
}

export function duplicateDirectiveDefinitionError(directiveName: string) {
  return new Error(`The directive "${directiveName}" has already been defined.`);
}

export function duplicateEnumValueDefinitionError(valueName: string, typeName: string): Error {
  return new Error(`Extension error:\n Value "${valueName}" already exists on enum "${typeName}".`);
}

export function duplicateFieldExtensionError(typeName: string, childName: string) {
  return new Error(
    `Extension error:\n` +
    ` More than one extension attempts to extend type "${typeName}" with the field "${childName}".`,
  );
}

export function duplicateInterfaceExtensionError(interfaceName: string, typeName: string): Error {
  return new Error(`Extension error:\n Interface "${interfaceName}" is already implemented by type "${typeName}".`);
}

export function duplicateInterfaceError(interfaceName: string, typeName: string): Error {
  return new Error(`Interface "${interfaceName}" can only be defined on type "${typeName}" once.`);
}

export function duplicateUnionMemberError(memberName: string, typeName: string): Error {
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

export function noDefinedUnionMembersError(unionName: string): Error {
  return new Error(`The union "${unionName}" must define at least one union member.`);
}

export function operationDefinitionError(typeName: string, operationType: OperationTypeNode, actualType: Kind): Error {
  return new Error(
    `Expected the response type "${typeName}" for operation "${operationType}" to be type object but received "${actualType}.`,
  );
}

export function shareableFieldDefinitionsError(parent: ObjectContainer, children: Set<string>): Error {
  const parentTypeName = parent.node.name.value;
  const errorMessages: string[] = [];
  for (const field of parent.fields.values()) {
    const fieldName = field.node.name.value;
    if (!children.has(fieldName)) {
      continue;
    }
    const shareableSubgraphs: string[] = [];
    const nonShareableSubgraphs: string[] = [];
    for (const [subgraphName, isShareable] of field.subgraphsByShareable) {
      isShareable ? shareableSubgraphs.push(subgraphName) : nonShareableSubgraphs.push(subgraphName);
    }
    if (shareableSubgraphs.length < 1) {
      errorMessages.push(
        `\n The field "${fieldName}" is defined in the following subgraphs: "${[...field.subgraphs].join('", "')}".` +
        `\n However, it it is not declared "@shareable" in any of them.`,
      );
    } else {
      errorMessages.push(
        `\n The field "${fieldName}" is defined and declared "@shareable" in the following subgraphs:` +
        ` "${shareableSubgraphs.join('", "')}".` +
        `\n However, it is not declared "@shareable" in the following subgraphs: ` +
        `"${nonShareableSubgraphs.join('", "')}".`,
      );
    }
  }
  return new Error(
    `The object "${parentTypeName}" defines the same fields in multiple subgraphs without the "@shareable" directive:` +
    `${errorMessages.join('\n')}`,
  );
}

export function undefinedDirectiveError(directiveName: string, hostPath: string): Error {
  return new Error(`The directive "${directiveName}" is declared on "${hostPath}",` +
    ` but the directive is not defined in the schema.`);
}

export function undefinedEntityKeyErrorMessage(fieldName: string, objectName: string): string {
  return (
    ` The "fields" argument defines "${fieldName}" as part of a key, but the field "${fieldName}" is not` +
    ` defined on the object "${objectName}".`
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
    (rootTypeFieldData.subgraphs.size > 1 ? 's' : '') + `: "` +
    [...rootTypeFieldData.subgraphs].join(QUOTATION_JOIN) + `".\n` +
    ` However, "${fieldPath}" is only defined in the following subgraph` +
    (fieldSubgraphs.length > 1 ? 's' : '') + `: "` + fieldSubgraphs + `".\n` +
    ` Consequently, "${fieldPath}" cannot be resolved through the root type field "${rootTypeFieldData.path}".\n` +
    `Potential solutions:\n` +
    ` Convert "${parentTypeName}" into an entity using the "@key" directive.\n` +
    ` Add the shareable root type field "${rootTypeFieldData.path}" to ` +
    (fieldSubgraphs.length > 1 ? 'one of the following subgraphs' : 'the following subgraph') + `: "`  +
    fieldSubgraphs.join(QUOTATION_JOIN) + `".\n` +
    `  For example (note that V1 fields are shareable by default and do not require a directive):\n` +
    `   type ${rootTypeFieldData.typeName} {\n` +
    `     ...\n` +
    `     ${rootTypeFieldData.fieldName}: ${rootTypeFieldData.fieldTypeNodeString} @shareable\n` +
    `   }`,
  );
}

export function undefinedTypeError(typeName: string): Error {
  return new Error(`The type "${typeName}" was referenced in the schema, but it was never defined.`);
}

export const federationUnexpectedNodeKindError = (parentName: string, fieldName: string) =>
  new Error(`Unexpected node kind for field "${parentName}.${fieldName}".`);

export const federationInvalidParentTypeError = (parentName: string, fieldName: string) =>
  new Error(`Could not find parent type "${parentName}" for field "${fieldName}".`);

export const federationRequiredInputFieldError = (parentName: string, fieldName: string) =>
  new Error(
    `Input object field "${parentName}.${fieldName}" is required in at least one subgraph; ` +
    `consequently, "${fieldName}" must be defined in all subgraphs that also define "${parentName}".`,
  );

export function invalidRepeatedDirectiveErrorMessage(directiveName: string, hostPath: string): string {
  return (
    `The definition for the directive "${directiveName}" does not define it as repeatable, ` +
    `but the same directive is declared more than once on type "${hostPath}".`
  );
}

export function invalidUnionError(unionName: string): Error {
  return new Error(`Union "${unionName}" must have at least one member.`);
}

export const invalidDeprecatedDirectiveError = new Error(`
  Expected the @deprecated directive to have a single optional argument "reason" of the type "String!"
`);

export const invalidTagDirectiveError = new Error(`
  Expected the @tag directive to have a single required argument "name" of the type "String!"
`);

export function invalidDirectiveError(
  directiveName: string,
  hostPath: string,
  errorMessages: string[],
): Error {
  return new Error(
    `The directive "${directiveName}" declared on "${hostPath}" is invalid for the following reason` +
    (errorMessages.length > 1 ? 's:\n' : ':\n') +
    errorMessages.join('\n'),
  );
}

export function invalidDirectiveLocationErrorMessage(
  hostPath: string,
  kind: Kind,
  directiveName: string,
): string {
  return (
    ` "${hostPath}" is type "${kind}", but the directive "${directiveName}" ` +
    `does not define "${nodeKindToDirectiveLocation(kind)}" as a valid location.`
  );
}

export function unexpectedDirectiveArgumentsErrorMessage(
  directive: ConstDirectiveNode,
  hostPath: string,
): string {
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
  return (
    ` The definition for the directive "${directiveName}" defines the following ` +
    requiredArguments.length +
    ` required argument` +
    (requiredArguments.length > 1 ? 's: ' : ': ') + `"` +
    requiredArguments.join('", "') + `"` +
    `.\n However, the same directive that is declared on "${hostPath}" does not define` +
    (missingRequiredArguments.length > 0
      ? ` the following required arguments: "${missingRequiredArguments.join('", "')}"`
      : ` any arguments.`)
  );
}

export function unexpectedDirectiveArgumentErrorMessage(directiveName: string, argumentName: string): string {
  return ` The definition for the directive "${directiveName}" does not define an argument named "${argumentName}".`;
}

export function duplicateDirectiveArgumentDefinitionErrorMessage(
  directiveName: string,
  hostPath: string,
  argumentName: string,
): string {
  return (
    ` The directive "${directiveName}" that is declared on "${hostPath}" ` +
    `defines the argument named "${argumentName}" more than once.`
  );
}

export function invalidKeyDirectiveArgumentErrorMessage(directiveKind: Kind): string {
  return ` The required argument named "fields" must be type "String" and not type "${directiveKind}".`;
}

export function invalidGraphQLNameErrorMessage(type: string, name: string): string {
  return ` The ${type} "${name}" is an invalid GraphQL name:\n` +
    `  GraphQL names must match the following regex: /[_a-zA-Z][_a-zA-Z0-9]*/`;
}

export const invalidOpeningBraceErrorMessage: string =
  ` Unexpected brace opening:\n  Received an opening brace "{" before the parent value was defined.`;

export const invalidClosingBraceErrorMessage: string =
  ` Unexpected brace closure:\n  Received a closing brace "}" before any nested values were defined.`;

export const invalidNestingClosureErrorMessage: string =
  ` Unexpected brace closure:\n  Received a closing brace "}" before its corresponding opening brace "{" was defined.`;

export const invalidNestingErrorMessage: string =
  ` Invalid nesting:\n  A nested key was terminated without a closing brace "}".`;

export function invalidEntityKeyError(parentTypeName: string, entityKey: string, errorMessage: string): Error {
  return new Error(
    `The directive "key" declared on the object "${parentTypeName}"` +
    ` with the "fields" argument value of "${entityKey}" is invalid for the following reason:\n` +
    errorMessage,
  );
}

export function invalidKeyDirectiveError(parentTypeName: string, errorMessages: string[]): Error {
  return new Error(
    `One or more "key" directives defined on "${parentTypeName}" are invalid for the following reason` +
    (errorMessages.length > 1 ? 's:\n' : ':\n') + errorMessages.join('\n'),
  );
}

export function undefinedParentFatalError(parentTypeName: string): Error {
  return new Error(
    `Fatal: Expected parent type "${parentTypeName}" to be defined.`,
  );
}

export function unexpectedKindFatalError(typeName: string) {
  return new Error(
    `Fatal: Unexpected type for "${typeName}"`,
  );
}

export function invalidMultiGraphNodeFatalError(nodeName: string): Error {
  return new Error(
    `Fatal: Expected node "${nodeName}" to exist in the multi graph.`
  );
}

export function incompatibleParentKindFatalError(parentTypeName: string, expectedKind: Kind, actualKind: Kind): Error {
  return new Error(
    `Fatal: Expected "${parentTypeName}" to be type ${kindToTypeString(expectedKind)}` +
    ` but received "${kindToTypeString(actualKind)}".`
  );
}

export function fieldTypeMergeFatalError(fieldName: string) {
  return new Error(
    `Fatal: Unsuccessfully merged the cross-subgraph types of field "${fieldName}"` +
    ` without producing a type error object.`
  )
}

export function argumentTypeMergeFatalError(argumentName: string, fieldName: string) {
  return new Error(
    `Fatal: Unsuccessfully merged the cross-subgraph types of argument "${argumentName}" on field "${fieldName}"` +
    ` without producing a type error object.`
  )
}

export function unexpectedArgumentKindFatalError(argumentName: string, fieldName: string) {
  return new Error(
    `Fatal: Unexpected type for argument "${argumentName}" on field "${fieldName}".`,
  );
}

export function unexpectedDirectiveLocationError(locationName: string): Error {
  return new Error(
    `Fatal: Unknown directive location "${locationName}".`,
  );
}

export function unexpectedTypeNodeKindError(childPath: string): Error {
  return new Error(
    `Fatal: Expected all constituent types of "${childPath}" to be one of the following: ` +
    `"LIST_TYPE", "NAMED_TYPE", or "NON_NULL_TYPE".`,
  );
}

export function invalidKeyFatalError<K>(key: K, mapName: string): Error {
  return new Error(
    `Fatal: Expected key "${key}" to exist in the map "${mapName}".`
  );
}

export function unexpectedParentKindErrorMessage(parentTypeName: string, expectedTypeString: string, actualTypeString: string): string {
  return (
    ` Expected "${parentTypeName}" to be type ${expectedTypeString} but received "${actualTypeString}".`
  );
}

export function objectInCompositeKeyWithoutSelectionsErrorMessage(fieldName: string, fieldTypeName: string): string {
  return (
    ` The "fields" argument defines "${fieldName}", which is type "${fieldTypeName}, as part of a key.\n` +
    ` However, "${fieldTypeName}" is an object type; consequently, it must have its own selections to be a valid key.`
  );
}

export function subgraphValidationError(subgraphName: string, errors: Error[]): Error {
  return new Error(
    `The subgraph "${subgraphName}" could not be federated for the following reason`
    + (errors.length > 1 ? 's:\n' : 's:\n') + errors.map((error) => error.message).join('\n'),
  );
}

export const subgraphValidationFailureErrorMessage: Error = new Error(
  ` Fatal: Subgraph validation did not return a valid AST.`,
);

export function invalidSubgraphNameErrorMessage(index: number, newName: string): string {
  return (
    `The ${numberToOrdinal(index + 1)} subgraph in the array did not define a name.` +
    ` Consequently, any further errors will temporarily identify this subgraph as "${newName}".`
  );
}

export function invalidOperationTypeDefinitionError(
  existingOperationType: OperationTypeNode, typeName: string, newOperationType: OperationTypeNode,
  ): Error {
  return new Error(
    `The schema definition defines the "${existingOperationType}" operation as type "${typeName}".` +
    ` However, "${typeName}" was also used for the "${newOperationType}" operation.\n` +
    ` If explicitly defined, each operation type must be a unique and valid Object type.`
  );
}

export function invalidRootTypeDefinitionError(
  operationType: OperationTypeNode, typeName: string, defaultTypeName: string
): Error {
  return new Error(
    `The schema definition defines the "${operationType}" operation as type "${typeName}".` +
    ` However, the schema also defines another type named "${defaultTypeName}",` +
    ` which is the default (root) type name for the "${operationType}" operation.\n` +
    `For federation, it is only possible to use the default root types names ("Mutation", "Query", "Subscription") as` +
    ` operation definitions. No other definitions with these default root type names are valid.`
  );
}

export function subgraphInvalidSyntaxError(error: Error): Error {
  return new Error(
    `The subgraph has syntax errors and could not be parsed:\n ${error}`
  );
}

export function unimplementedInterfaceFieldsError(
  parentTypeName: string,
  parentTypeString: string,
  implementationErrorsMap: ImplementationErrorsMap,
): Error {
  const messages: string[] = [];
  for (const [interfaceName, implementationErrors] of implementationErrorsMap) {
    let message = ` The implementation of interface "${interfaceName}" by "${parentTypeName}"` +
      ` is invalid because:\n`;
    const unimplementedFieldsLength = implementationErrors.unimplementedFields.length;
    if (unimplementedFieldsLength) {
      message += `  The following field${unimplementedFieldsLength > 1 ? 's are' : ' is'} not implemented: "`
        + implementationErrors.unimplementedFields.join('", "') + '"\n';
    }
    for (const [fieldName, invalidFieldImplementation] of implementationErrors.invalidFieldImplementations) {
      const unimplementedArgumentsSize = invalidFieldImplementation.unimplementedArguments.size;
      const invalidArgumentsLength = invalidFieldImplementation.invalidImplementedArguments.length;
      const invalidAdditionalArgumentsSize= invalidFieldImplementation.invalidAdditionalArguments.size;
      message += `  The field "${fieldName}" is invalid because:\n`;
      if (unimplementedArgumentsSize) {
        message += `   The following argument${unimplementedArgumentsSize > 1 ? 's are' : ' is'} not implemented: "`
          + [...invalidFieldImplementation.unimplementedArguments].join('", "') + '"\n';
      }
      if (invalidArgumentsLength) {
        message += `   The following implemented argument${invalidArgumentsLength > 1 ? 's are' : ' is'} invalid:\n`;
        for (const invalidArgument of invalidFieldImplementation.invalidImplementedArguments) {
          message += `    The argument "${invalidArgument.argumentName}" must define type "` +
            invalidArgument.expectedType + `" and not "${invalidArgument.actualType}"\n`;
        }
      }
      if (invalidAdditionalArgumentsSize) {
        message += `   If a field from an interface is implemented, any additional arguments that were not defined` +
          ` on the original interface field must be optional (nullable).\n`;
          message += `    The following additional argument` +
            (invalidFieldImplementation.invalidAdditionalArguments.size > 1 ? `s are` : ` is`) +
            ` not defined as optional: "` +
            [...invalidFieldImplementation.invalidAdditionalArguments].join(`", "`) + `"\n`
      }
      if (invalidFieldImplementation.implementedResponseType) {
        message += `   The implemented response type "${invalidFieldImplementation.implementedResponseType}" is not` +
          ` a valid subset (equally or more restrictive) of the response type "` +
          invalidFieldImplementation.originalResponseType + `" for "${interfaceName}.${fieldName}".`;
      }
    }
    messages.push(message);
  }
  return new Error(
    `The ${parentTypeString} "${parentTypeName}" has the following interface implementation errors:\n` +
    messages.join('\n')
  );
}

export function invalidRequiredArgumentsError(
  typeString: string, path: string, errors: InvalidRequiredArgument[],
): Error {
  let message = `The ${typeString} "${path}" could not be federated because:\n`;
  for (const error of errors) {
    message += ` The argument "${error.argumentName}" is required in the following subgraph` +
      (error.requiredSubgraphs.length > 1 ? 's' : '' ) +': "' + error.requiredSubgraphs.join(`", "`) + `"\n` +
      ` However, the argument "${error.argumentName}" is not defined in the following subgraph` +
      (error.missingSubgraphs.length > 1 ? 's' : '' ) +': "' + error.missingSubgraphs.join(`", "`) + `"\n` +
      ` If an argument is required on a ${typeString} in any one subgraph, it must be at least defined as optional` +
      ` on all other definitions of that ${typeString} in all other subgraphs.\n`
  }
  return new Error(message);
}

export function duplicateArgumentsError(fieldPath: string, duplicatedArguments: string[]): Error {
  return new Error(
    `The field "${fieldPath}" is invalid because:\n` +
    ` The following argument` + (duplicatedArguments.length > 1 ? 's are' : ' is') +
    ` defined more than once: "` + duplicatedArguments.join(`", "`) + `"\n`
  );
}

export function invalidArgumentsError(fieldPath: string, invalidArguments: InvalidArgument[]): Error {
  let message = `The field "${fieldPath}" is invalid because:\n` +
    ` The named type (root type) of an input must be on of Enum, Input Object, or Scalar type.` +
    ` For example: "Float", "[[String!]]!", or "[SomeInputObjectName]"\n`
  for (const invalidArgument of invalidArguments) {
    message += `  The argument "${invalidArgument.argumentName}" defines type "${invalidArgument.typeName}"` +
      ` but the named type "${invalidArgument.namedType}" is type "` + invalidArgument.typeString +
      `", which is not a valid input type.\n`;
  }
  return new Error(message);
}

export const noQueryRootTypeError = new Error(
    `A valid federated graph must have at least one populated query root type.\n` +
  ` For example:\n` +
  `  type Query {\n` +
  `    dummy: String\n` +
  `  }`
);

export function unexpectedObjectResponseType(fieldPath: string, actualTypeString: string): Error {
  return new Error(
    `Expected the path "${fieldPath}" to have the response type` +
    ` Enum, Interface, Object, Scalar, or Union but received ${actualTypeString}.`
  );
}

export function noConcreteTypesForAbstractTypeError(typeString: string, abstractTypeName: string): Error {
  return new Error(
    `Expected ${typeString} "${abstractTypeName}" to define at least one ` +
    (typeString === UNION ? 'member' : 'object that implements the interface') +
    ` but received none`
  );
}

export function expectedEntityError(typeName: string): Error {
  return new Error(
    `Expected object "${typeName}" to define a "key" directive, but it defines no directives.`
  );
}