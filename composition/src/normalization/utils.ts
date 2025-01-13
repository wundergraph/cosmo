import {
  ConstDirectiveNode,
  DirectiveDefinitionNode,
  DocumentNode,
  InputValueDefinitionNode,
  Kind,
  OperationTypeNode,
  print,
  TypeNode,
} from 'graphql';
import { lexicographicallySortDocumentNode } from '../ast/utils';
import {
  ARGUMENT_DEFINITION_UPPER,
  ENUM_UPPER,
  ENUM_VALUE_UPPER,
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
import {
  invalidEventSubjectsArgumentErrorMessage,
  undefinedEventSubjectsArgumentErrorMessage,
  unexpectedDirectiveLocationError,
} from '../errors/errors';
import { EDFS_ARGS_REGEXP } from '../utils/constants';
import { RequiredFieldConfiguration } from '../router-configuration/router-configuration';
import { CompositeOutputData, InputValueData } from '../schema-building/type-definition-data';

export type KeyFieldSetData = {
  documentNode: DocumentNode;
  isConditionalSource: boolean;
  isUnresolvable: boolean;
  normalizedFieldSet: string;
  rawFieldSet: string;
};

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

export type ConditionalFieldSetValidationResult = {
  errorMessages: Array<string>;
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

export function getInitialFieldCoordinatesPath(isProvides: boolean, hostCoordinates: string): Array<string> {
  if (isProvides) {
    return [hostCoordinates];
  }
  return [];
}

export function getInitialTypePath(
  isProvides: boolean,
  providesHostTypeName: string,
  parentTypeName: string,
): Array<string> {
  if (isProvides) {
    return [providesHostTypeName, parentTypeName];
  }
  return [parentTypeName];
}

export type FieldSetParentResult = {
  errorString?: string;
  fieldSetParentData?: CompositeOutputData;
};

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
