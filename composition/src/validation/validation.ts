import {
  duplicateArgumentDefinitionError,
  invalidArgumentValueError,
  invalidCustomDirectiveError,
  invalidDirectiveLocationError,
  invalidRepeatedDirectiveError,
  undefinedRequiredArgumentsError,
  unexpectedArgumentProvisionError,
} from '../errors/errors';
import { nodeKindToDirectiveLocation } from '../ast/utils';
import { getNamedTypeNode, getTypeNodeNamedTypeName, type MutableInputValueNode } from '../schema-building/ast';
import { sanitizeDefaultValue } from '../schema-building/utils';
import {
  type IsArgumentValueValidParams,
  type ValidateCustomDirectiveParams,
  type ValidateDirectivesParams,
} from './types/params';
import { Kind, print } from 'graphql';
import {
  BOOLEAN_SCALAR,
  EXECUTION,
  FIELD_SET_SCALAR,
  FLOAT_SCALAR,
  ID_SCALAR,
  INACCESSIBLE,
  INT_SCALAR,
  LINK_IMPORT,
  LINK_PURPOSE,
  SCOPE_SCALAR,
  SECURITY,
  STRING_SCALAR,
  SUBSCRIPTION_FIELD_CONDITION,
  SUBSCRIPTION_FILTER_CONDITION,
} from '../utils/string-constants';
import { printTypeNode } from '@graphql-tools/merge';
import { type ArgumentName } from '../types/types';
import { getEntriesNotInHashSet, numberToOrdinal } from '../utils/utils';
import { type ExecutionMultiResult } from '../types/results';

export function isArgumentValueValid({
  argumentValue,
  parentDefinitionDataByTypeName,
  typeNode,
}: IsArgumentValueValidParams): boolean {
  if (argumentValue.kind === Kind.NULL) {
    return typeNode.kind !== Kind.NON_NULL_TYPE;
  }
  switch (typeNode.kind) {
    case Kind.LIST_TYPE: {
      if (argumentValue.kind !== Kind.LIST) {
        // This handles List coercion
        return isArgumentValueValid({
          argumentValue,
          parentDefinitionDataByTypeName,
          typeNode: getNamedTypeNode(typeNode.type),
        });
      }
      for (const value of argumentValue.values) {
        if (!isArgumentValueValid({ argumentValue: value, parentDefinitionDataByTypeName, typeNode: typeNode.type })) {
          return false;
        }
      }
      return true;
    }
    case Kind.NAMED_TYPE: {
      switch (typeNode.name.value) {
        case BOOLEAN_SCALAR: {
          return argumentValue.kind === Kind.BOOLEAN;
        }
        case FLOAT_SCALAR: {
          return argumentValue.kind === Kind.FLOAT || argumentValue.kind === Kind.INT;
        }
        case ID_SCALAR: {
          return argumentValue.kind === Kind.STRING || argumentValue.kind === Kind.INT;
        }
        case INT_SCALAR: {
          return argumentValue.kind === Kind.INT;
        }
        case FIELD_SET_SCALAR:
        // intentional fallthrough
        case SCOPE_SCALAR:
        // intentional fallthrough
        case STRING_SCALAR: {
          return argumentValue.kind === Kind.STRING;
        }
        case LINK_IMPORT: {
          return true;
        }
        case LINK_PURPOSE: {
          if (argumentValue.kind !== Kind.ENUM) {
            return false;
          }
          return argumentValue.value === SECURITY || argumentValue.value === EXECUTION;
        }
        case SUBSCRIPTION_FIELD_CONDITION:
        // intentional fallthrough
        case SUBSCRIPTION_FILTER_CONDITION:
          return argumentValue.kind === Kind.OBJECT;
        default: {
          const parentData = parentDefinitionDataByTypeName.get(typeNode.name.value);
          if (!parentData) {
            return false;
          }
          if (parentData.kind === Kind.SCALAR_TYPE_DEFINITION) {
            // For now, allow custom scalars to be any value kind.
            return true;
          }
          if (parentData.kind === Kind.ENUM_TYPE_DEFINITION) {
            if (argumentValue.kind !== Kind.ENUM && argumentValue.kind !== Kind.STRING) {
              return false;
            }
            const enumValue = parentData.enumValueDataByName.get(argumentValue.value);
            if (!enumValue) {
              return false;
            }
            return !enumValue.directivesByName.has(INACCESSIBLE);
          }
          if (parentData.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION) {
            return false;
          }
          // TODO deep comparison
          return argumentValue.kind === Kind.OBJECT;
        }
      }
    }
    default: {
      return isArgumentValueValid({ argumentValue, parentDefinitionDataByTypeName, typeNode: typeNode.type });
    }
  }
}

export function validateCustomDirective({
  argumentDataByName,
  directiveNode,
  parentDefinitionDataByTypeName,
  requiredArgumentNames,
}: ValidateCustomDirectiveParams): ExecutionMultiResult {
  if (!directiveNode.arguments || directiveNode.arguments.length < 1) {
    if (requiredArgumentNames.length < 1) {
      return {
        success: true,
      };
    }

    return {
      errors: [undefinedRequiredArgumentsError(requiredArgumentNames)],
      success: false,
    };
  }

  const errors: Array<Error> = [];
  const definedArgumentNames = new Set<ArgumentName>();
  const duplicateArgumentNames = new Set<ArgumentName>();
  const unexpectedArgumentNames = new Set<ArgumentName>();
  for (const argumentNode of directiveNode.arguments) {
    const argumentName = argumentNode.name.value;
    if (definedArgumentNames.has(argumentName)) {
      duplicateArgumentNames.add(argumentName);
      continue;
    }
    definedArgumentNames.add(argumentName);
    const argumentData = argumentDataByName.get(argumentName);
    if (!argumentData) {
      unexpectedArgumentNames.add(argumentName);
      continue;
    }
    if (
      !isArgumentValueValid({
        argumentValue: argumentNode.value,
        parentDefinitionDataByTypeName,
        typeNode: argumentData.type,
      })
    ) {
      errors.push(
        invalidArgumentValueError({
          argumentName,
          expectedTypeString: printTypeNode(argumentData.type),
          value: print(argumentNode.value),
        }),
      );
    }
  }

  if (duplicateArgumentNames.size > 0) {
    errors.push(duplicateArgumentDefinitionError([...duplicateArgumentNames]));
  }
  if (unexpectedArgumentNames.size > 0) {
    errors.push(unexpectedArgumentProvisionError([...unexpectedArgumentNames]));
  }
  const undefinedArgumentNames = getEntriesNotInHashSet(requiredArgumentNames, definedArgumentNames);
  if (undefinedArgumentNames.length > 0) {
    errors.push(undefinedRequiredArgumentsError(undefinedArgumentNames));
  }

  if (errors.length > 0) {
    return {
      errors,
      success: false,
    };
  }

  return {
    success: true,
  };
}

export function validateDirectives({
  data,
  directiveCoords,
  directiveDefinitionData: {
    argumentDataByName,
    isComposed,
    isRepeatable,
    locations,
    name,
    node,
    requiredArgumentNames,
  },
  directiveNodes,
  parentDefinitionDataByTypeName,
}: ValidateDirectivesParams): ExecutionMultiResult {
  const errors: Array<Error> = [];
  const directiveLocation = nodeKindToDirectiveLocation(data.kind);
  if (!locations.has(directiveLocation)) {
    errors.push(invalidDirectiveLocationError({ directiveCoords, directiveName: name, location: directiveLocation }));
  }
  if (directiveNodes.length > 1 && !isRepeatable && !isComposed) {
    errors.push(invalidRepeatedDirectiveError({ directiveCoords, directiveName: name }));
  }
  const requiredArgumentNamesArray = [...requiredArgumentNames];
  for (const argumentNode of node.arguments ?? []) {
    if (!argumentNode.defaultValue) {
      continue;
    }

    const argumentData = argumentDataByName.get(argumentNode.name.value);
    if (!argumentData) {
      continue;
    }

    const namedTypeData = parentDefinitionDataByTypeName.get(getTypeNodeNamedTypeName(argumentData.type));
    // Undefined types are handled elsewhere
    if (!namedTypeData) {
      continue;
    }

    sanitizeDefaultValue({ data: argumentData, namedTypeData, node: argumentNode as MutableInputValueNode });
  }

  for (let i = 0; i < directiveNodes.length; i++) {
    const directiveNode = directiveNodes[i];
    const validationResult = validateCustomDirective({
      argumentDataByName,
      directiveNode,
      parentDefinitionDataByTypeName,
      requiredArgumentNames: requiredArgumentNamesArray,
    });
    if (!validationResult.success) {
      errors.push(
        invalidCustomDirectiveError({
          directiveCoords,
          directiveName: name,
          errors: validationResult.errors,
          ordinal: numberToOrdinal(i + 1),
        }),
      );
    }
  }

  if (errors.length > 0) {
    return {
      errors,
      success: false,
    };
  }

  return {
    success: true,
  };
}
