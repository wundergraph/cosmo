import { ChangeType } from '@graphql-inspector/core';
import { ClickHouseClient } from '../clickhouse/index.js';
import { SchemaDiff } from '../composition/schemaCheck.js';
import { SchemaCheckChangeAction } from '../../db/models.js';

export enum FieldTypeChangeCategory {
  /**
   * Optional same type -> Required same type
   * Example: "Boolean" -> "Boolean!"
   */
  OPTIONAL_TO_REQUIRED_SAME = 'OPTIONAL_TO_REQUIRED_SAME',
  /**
   * Optional different type -> Required different type
   * Example: "Boolean" -> "String!"
   */
  OPTIONAL_TO_REQUIRED_DIFFERENT = 'OPTIONAL_TO_REQUIRED_DIFFERENT',
  /**
   * Required different type -> Required different type
   * Example: "Boolean!" -> "String!"
   */
  REQUIRED_TO_REQUIRED_DIFFERENT = 'REQUIRED_TO_REQUIRED_DIFFERENT',
  /**
   * Optional different type -> Optional different type
   * Example: "Boolean" -> "String"
   */
  OPTIONAL_TO_OPTIONAL_DIFFERENT = 'OPTIONAL_TO_OPTIONAL_DIFFERENT',
}

/**
 * Extract base types by removing:
 * - Trailing "!" (required indicator)
 * - Array brackets like "[Boolean!]" -> "Boolean!"
 * - Inner "!" from arrays like "[Boolean!]" -> "Boolean"
 */
function extractBaseType(type: string): string {
  let base = type.trim();

  // Remove trailing "!"
  if (base.endsWith('!')) {
    base = base.slice(0, -1).trim();
  }

  // Handle array types like "[Boolean!]" or "[Boolean!]!"
  // Remove outer brackets and inner "!"
  if (base.startsWith('[') && base.endsWith(']')) {
    base = base.slice(1, -1).trim();
    // Remove inner "!" if present
    if (base.endsWith('!')) {
      base = base.slice(0, -1).trim();
    }
  }

  return base;
}

/**
 * Normalize type for structural comparison (remove required indicators but keep structure)
 */
function normalizeType(type: string): string {
  let normalized = type.trim();
  // Remove trailing "!" but keep array structure
  if (normalized.endsWith('!')) {
    normalized = normalized.slice(0, -1).trim();
  }
  return normalized;
}

/**
 * Parses an argument removal message and determines if the argument was required.
 *
 * @param message - String in format: "Argument 'name: Type' was removed from field 'TypeName.fieldName'"
 * @returns true if the argument was required (type ends with '!'), false if optional
 *
 * @example
 * parseArgumentRemoval("Argument 'criteria: SearchInput!' was removed from field 'Query.findEmployees'")
 * // Returns true (required)
 *
 * @example
 * parseArgumentRemoval("Argument 'criteria: SearchInput' was removed from field 'Query.findEmployees'")
 * // Returns false (optional)
 */
export function parseArgumentRemoval(message: string): boolean {
  // Extract the argument type from the message
  // Format: "Argument 'name: Type' was removed from field '...'"
  const match = message.match(/Argument '([^:]+):\s*([^']+)' was removed/);

  if (!match || match.length < 3) {
    throw new Error(`Invalid argument removal message format: ${message}`);
  }

  const argumentType = match[2].trim();

  // Check if the type ends with "!" to determine if it was required
  return argumentType.endsWith('!');
}

/**
 * Parses a type change message (for both input fields and arguments) and categorizes it into one of the FieldTypeChangeCategory cases.
 * Supports two message formats:
 * - "Input field 'TypeName.fieldName' changed type from 'FromType' to 'ToType'"
 * - "Type for argument 'name' on field 'TypeName.fieldName' changed from 'FromType' to 'ToType'"
 *
 * @param message - String in either format above
 * @returns The category of the type change
 *
 * @example
 * parseTypeChange("Input field 'SearchInput.hasPets' changed type from 'Boolean!' to '[Boolean!]!'")
 * // Returns FieldTypeChangeCategory.REQUIRED_DIFFERENT_TO_REQUIRED_DIFFERENT
 *
 * @example
 * parseTypeChange("Type for argument 'criteria' on field 'Query.findEmployees' changed from 'SearchInput' to 'SearchInput!'")
 * // Returns FieldTypeChangeCategory.OPTIONAL_SAME_TO_REQUIRED_SAME
 */
export function parseTypeChange(message: string): FieldTypeChangeCategory {
  // Try both patterns: "changed type from" (input fields) and "changed from" (arguments)
  const match =
    message.match(/changed type from '([^']+)' to '([^']+)'/) || message.match(/changed from '([^']+)' to '([^']+)'/);

  if (!match || match.length < 3) {
    throw new Error(`Invalid type change message format: ${message}`);
  }

  const fromType = match[1];
  const toType = match[2];

  // Determine if types are required (end with "!")
  const fromRequired = fromType.endsWith('!');
  const toRequired = toType.endsWith('!');

  const fromBaseType = extractBaseType(fromType);
  const toBaseType = extractBaseType(toType);
  const fromNormalized = normalizeType(fromType);
  const toNormalized = normalizeType(toType);

  // Check if base types are the same AND structure is the same
  const sameBaseType = fromBaseType === toBaseType;
  const sameStructure = fromNormalized === toNormalized;

  // Types are considered "same" only if both base type and structure match
  const sameType = sameBaseType && sameStructure;

  // Categorize based on the 4 cases
  if (sameType && !fromRequired && toRequired) {
    // Case 1: Optional same type -> Required same type
    // Example: "Boolean" -> "Boolean!"
    return FieldTypeChangeCategory.OPTIONAL_TO_REQUIRED_SAME;
  } else if (!sameType && !fromRequired && toRequired) {
    // Case 2: Optional different type -> Required different type
    // Example: "Boolean" -> "String!"
    return FieldTypeChangeCategory.OPTIONAL_TO_REQUIRED_DIFFERENT;
  } else if (!sameType && fromRequired && toRequired) {
    // Case 3: Required different type -> Required different type
    // Example: "Boolean!" -> "String!"
    return FieldTypeChangeCategory.REQUIRED_TO_REQUIRED_DIFFERENT;
  } else if (!sameType && !fromRequired && !toRequired) {
    // Case 4: Optional different type -> Optional different type
    // Example: "Boolean" -> "String"
    return FieldTypeChangeCategory.OPTIONAL_TO_OPTIONAL_DIFFERENT;
  } else {
    // Edge case: same type, from required, to optional (shouldn't happen in breaking changes)
    // Fallback to same type becoming required
    return FieldTypeChangeCategory.OPTIONAL_TO_REQUIRED_SAME;
  }
}

export interface InspectorSchemaChange {
  schemaChangeId: string;
  typeName?: string;
  namedType?: string;
  fieldName?: string;
  path?: string[];
  isInput?: boolean;
  isArgument?: boolean;
  isNull?: boolean;
}

export interface InspectorFilter {
  federatedGraphId: string;
  organizationId: string;
  daysToConsider: number;
  subgraphId: string;
}

export interface InspectorOperationResult {
  schemaChangeId: string;
  hash: string;
  name: string;
  type: string;
  lastSeenAt: Date;
  firstSeenAt: Date;
  isSafeOverride: boolean;
}

export class SchemaUsageTrafficInspector {
  constructor(private client: ClickHouseClient) {}

  /**
   * Inspect the usage of a schema change in the last X days on real traffic and return the
   * affected operations. We will consider all available compositions.
   * @param changes - Array of inspector changes
   */
  public async inspect(
    changes: InspectorSchemaChange[],
    filter: InspectorFilter,
  ): Promise<Map<string, InspectorOperationResult[]>> {
    const results: Map<string, InspectorOperationResult[]> = new Map();

    for (const change of changes) {
      const where: string[] = [];

      // Used for arguments usage check
      if (change.path) {
        where.push(
          `startsWith(Path, [${change.path.map((seg) => `'${seg}'`).join(',')}]) AND length(Path) = ${
            change.path.length
          }`,
        );
      }
      if (change.namedType) {
        where.push(`NamedType = '${change.namedType}'`);
      }
      if (change.typeName) {
        where.push(`hasAny(TypeNames, ['${change.typeName}'])`);
      }

      // fieldName can be empty if a type was removed
      if (change.fieldName) {
        where.push(`FieldName = '${change.fieldName}'`);
      }

      if (change.isInput) {
        where.push(`IsInput = true`);
      } else if (change.isArgument) {
        where.push(`IsArgument = true`);
      }

      if (change.isNull !== undefined) {
        where.push(`IsNull = ${change.isNull}`);
      }
      where.push(`IsIndirectFieldUsage = false`);

      const query = `
        SELECT OperationHash as operationHash,
               last_value(OperationType) as operationType,
               last_value(OperationName) as operationName,
               min(toUnixTimestamp(Timestamp)) as firstSeen,
               max(toUnixTimestamp(Timestamp)) as lastSeen
        FROM ${this.client.database}.gql_metrics_schema_usage_lite_1d_90d
        WHERE
          -- Filter first on date and customer to reduce the amount of data
          Timestamp >= toStartOfDay(now()) - interval ${filter.daysToConsider} day AND
          FederatedGraphID = '${filter.federatedGraphId}' AND
          hasAny(SubgraphIDs, ['${filter.subgraphId}']) AND
          OrganizationID = '${filter.organizationId}' AND
          ${where.join(' AND ')}
        GROUP BY OperationHash
    `;

      const res: {
        operationHash: string;
        operationName: string;
        operationType: string;
        lastSeen: number;
        firstSeen: number;
      }[] = await this.client.queryPromise(query);

      if (Array.isArray(res)) {
        const ops = res.map((r) => ({
          schemaChangeId: change.schemaChangeId,
          hash: r.operationHash,
          name: r.operationName,
          type: r.operationType,
          lastSeenAt: new Date(r.lastSeen * 1000),
          firstSeenAt: new Date(r.firstSeen * 1000),
          isSafeOverride: false,
        }));

        if (ops.length > 0) {
          results.set(change.schemaChangeId, [...(results.get(change.schemaChangeId) || []), ...ops]);
        }
      }
    }

    return results;
  }

  /**
   * Convert schema changes to inspector changes. Will ignore a change if it is not inspectable.
   * Ultimately, will result in a breaking change because the change is not inspectable with the current implementation.
   * Returns an array of inspector changes.
   */
  public schemaChangesToInspectorChanges(
    schemaChanges: SchemaDiff[],
    schemaCheckActions: SchemaCheckChangeAction[],
  ): InspectorSchemaChange[] {
    const operations = schemaChanges
      .map((change) => {
        // find the schema check action that matches the change
        const schemaCheckAction = schemaCheckActions.find(
          (action) => action.path === change.path && action.changeType === change.changeType,
        );
        // there must be a schema check action for every change otherwise it is a bug
        if (!schemaCheckAction) {
          throw new Error(`Could not find schema check action for change ${change.message}`);
        }
        return toInspectorChange(change, schemaCheckAction.id);
      })
      .filter((change) => change !== null) as InspectorSchemaChange[];

    return operations;
  }
}

export function collectOperationUsageStats(inspectorResult: InspectorOperationResult[]) {
  // Only consider unique hashes
  const inspectedOperations: InspectorOperationResult[] = [];

  const uniqueHashes: { [key: string]: boolean } = {};
  for (const result of inspectorResult) {
    if (!uniqueHashes[result.hash]) {
      uniqueHashes[result.hash] = true;
      inspectedOperations.push(result);
    }
  }

  const totalOperations = inspectedOperations.length;
  const safeOperations = inspectedOperations.filter((op) => op.isSafeOverride).length;

  if (inspectedOperations.length === 0) {
    return {
      totalOperations,
      safeOperations,
      firstSeenAt: new Date().toUTCString(),
      lastSeenAt: new Date().toUTCString(),
    };
  }

  let firstSeenAt = new Date(inspectedOperations[0].firstSeenAt);
  let lastSeenAt = new Date(inspectedOperations[0].lastSeenAt);

  for (let i = 1; i < inspectedOperations.length; i++) {
    const currentFirstSeenAt = new Date(inspectedOperations[i].firstSeenAt);
    const currentLastSeenAt = new Date(inspectedOperations[i].lastSeenAt);

    if (currentFirstSeenAt < firstSeenAt) {
      firstSeenAt = currentFirstSeenAt;
    }

    if (currentLastSeenAt > lastSeenAt) {
      lastSeenAt = currentLastSeenAt;
    }
  }

  return {
    totalOperations,
    safeOperations,
    firstSeenAt: firstSeenAt.toUTCString(),
    lastSeenAt: lastSeenAt.toUTCString(),
  };
}

/**
 * Convert a schema change to an inspector change. Throws an error if the change is not supported.
 * Only breaking changes should be passed to this function because we only care about breaking changes.
 * Returns an inspector change with the schemaChangeId included.
 */
export function toInspectorChange(change: SchemaDiff, schemaCheckId: string): InspectorSchemaChange | null {
  const path = change.path.split('.');

  switch (change.changeType) {
    // Not inspectable yet
    case ChangeType.SchemaMutationTypeChanged:
    case ChangeType.SchemaQueryTypeChanged:
    case ChangeType.SchemaSubscriptionTypeChanged:
    case ChangeType.DirectiveRemoved:
    case ChangeType.DirectiveArgumentAdded:
    case ChangeType.DirectiveArgumentRemoved:
    case ChangeType.DirectiveArgumentDefaultValueChanged:
    case ChangeType.DirectiveArgumentTypeChanged:
    case ChangeType.DirectiveLocationRemoved: {
      // We cannot inspect these changes. We want to return null instead of throwing an error.
      // This is so that other changes that we can in fact inspect are not skipped over in the schema check.
      return null;
    }

    // Safe to ignore
    case ChangeType.DirectiveAdded:
    case ChangeType.FieldArgumentDescriptionChanged:
    case ChangeType.FieldArgumentDefaultChanged:
    case ChangeType.DirectiveDescriptionChanged:
    case ChangeType.DirectiveArgumentDescriptionChanged:
    case ChangeType.DirectiveLocationAdded:
    case ChangeType.EnumValueDescriptionChanged:
    case ChangeType.EnumValueDeprecationReasonChanged:
    case ChangeType.EnumValueDeprecationReasonAdded:
    case ChangeType.EnumValueDeprecationReasonRemoved:
    case ChangeType.FieldDescriptionChanged:
    case ChangeType.FieldDescriptionAdded:
    case ChangeType.FieldDescriptionRemoved:
    case ChangeType.FieldDeprecationAdded:
    case ChangeType.FieldDeprecationRemoved:
    case ChangeType.FieldDeprecationReasonChanged:
    case ChangeType.FieldDeprecationReasonAdded:
    case ChangeType.FieldDeprecationReasonRemoved:
    case ChangeType.InputFieldDescriptionAdded:
    case ChangeType.InputFieldDescriptionRemoved:
    case ChangeType.InputFieldDescriptionChanged:
    case ChangeType.InputFieldDefaultValueChanged:
    case ChangeType.TypeDescriptionChanged:
    case ChangeType.TypeDescriptionRemoved:
    case ChangeType.TypeDescriptionAdded:
    case ChangeType.TypeAdded:
    case ChangeType.FieldAdded:
    case ChangeType.UnionMemberAdded:
    case ChangeType.DirectiveUsageUnionMemberAdded:
    case ChangeType.DirectiveUsageUnionMemberRemoved:
    case ChangeType.DirectiveUsageEnumAdded:
    case ChangeType.DirectiveUsageEnumRemoved:
    case ChangeType.DirectiveUsageEnumValueAdded:
    case ChangeType.DirectiveUsageEnumValueRemoved:
    case ChangeType.DirectiveUsageInputObjectAdded:
    case ChangeType.DirectiveUsageInputObjectRemoved:
    case ChangeType.DirectiveUsageFieldAdded:
    case ChangeType.DirectiveUsageFieldRemoved:
    case ChangeType.DirectiveUsageScalarAdded:
    case ChangeType.DirectiveUsageScalarRemoved:
    case ChangeType.DirectiveUsageObjectAdded:
    case ChangeType.DirectiveUsageObjectRemoved:
    case ChangeType.DirectiveUsageInterfaceAdded:
    case ChangeType.DirectiveUsageInterfaceRemoved:
    case ChangeType.DirectiveUsageArgumentDefinitionAdded:
    case ChangeType.DirectiveUsageArgumentDefinitionRemoved:
    case ChangeType.DirectiveUsageSchemaAdded:
    case ChangeType.DirectiveUsageSchemaRemoved:
    case ChangeType.DirectiveUsageFieldDefinitionAdded:
    case ChangeType.DirectiveUsageFieldDefinitionRemoved:
    case ChangeType.DirectiveUsageInputFieldDefinitionAdded:
    case ChangeType.DirectiveUsageInputFieldDefinitionRemoved: {
      return null;
    }
    // 1. When a type is removed we know the exact type name e.g. 'Engineer'. We have no field name.
    // 2. When an interface type is removed or added we know the interface 'RoleType'. We have no field name.
    case ChangeType.TypeRemoved:
    case ChangeType.TypeKindChanged:
    case ChangeType.ObjectTypeInterfaceAdded:
    case ChangeType.ObjectTypeInterfaceRemoved: {
      return {
        schemaChangeId: schemaCheckId,
        typeName: path[0],
      };
    }
    // 1. When a field is removed we know the exact type and field name e.g. 'Engineer.name'
    // 2. When a field type has changed in a breaking way, we know the exact type name and field name e.g. 'Engineer.name'
    case ChangeType.FieldRemoved:
    case ChangeType.FieldTypeChanged: {
      return {
        schemaChangeId: schemaCheckId,
        typeName: path[0],
        fieldName: path[1],
      };
    }
    // 1. When an enum value is added or removed, we only know the affected type. This is fine because any change to an enum value is breaking.
    // 2. When a union member is removed, we only know the affected parent type. We use namedType to check for the usage of the union member.
    case ChangeType.UnionMemberRemoved:
    case ChangeType.EnumValueAdded:
    case ChangeType.EnumValueRemoved: {
      return {
        schemaChangeId: schemaCheckId,
        namedType: path[0],
      };
    }
    // 1. When the type of input field has changed, we know the exact type name and field name e.g. 'MyInput.name'
    case ChangeType.InputFieldTypeChanged: {
      const inputFieldTypeChangeCategory = parseTypeChange(change.message);
      switch (inputFieldTypeChangeCategory) {
        case FieldTypeChangeCategory.OPTIONAL_TO_REQUIRED_SAME: {
          // Int -> Int!
          return {
            schemaChangeId: schemaCheckId,
            // if the input is used and the field is not passed,
            // but now that it is required, its breaking
            typeName: path[0],
            fieldName: path[1],
            isInput: true,
            isNull: true,
          };
        }
        case FieldTypeChangeCategory.OPTIONAL_TO_REQUIRED_DIFFERENT: {
          // Int -> Float!
          // in this case, all the ops which have this input type are breaking
          return {
            schemaChangeId: schemaCheckId,
            path: [path[0]],
            isInput: true,
            isNull: false,
          };
        }
        case FieldTypeChangeCategory.REQUIRED_TO_REQUIRED_DIFFERENT: {
          // Int! -> Float!
          // in this case, all the ops which have this input type are breaking
          return {
            schemaChangeId: schemaCheckId,
            path: [path[0]],
            isInput: true,
            isNull: false,
          };
        }
        case FieldTypeChangeCategory.OPTIONAL_TO_OPTIONAL_DIFFERENT: {
          // Int -> Float
          // in this case, any ops which use the input field and are not null are breaking
          return {
            schemaChangeId: schemaCheckId,
            typeName: path[0],
            fieldName: path[1],
            isInput: true,
            isNull: false,
          };
        }
        default: {
          throw new Error(`Unsupported input field type change category: ${inputFieldTypeChangeCategory}`);
        }
      }
    }
    case ChangeType.InputFieldRemoved:
    case ChangeType.InputFieldAdded: {
      // in these cases, all the ops which use this input type are breaking
      return {
        schemaChangeId: schemaCheckId,
        path: [path[0]],
        isInput: true,
        isNull: false,
      };
    }
    // 1. When an argument has changed, we know the exact path to the argument e.g. 'Query.engineer.id'
    // and the type name e.g. 'Query'
    case ChangeType.FieldArgumentTypeChanged: {
      const argumentTypeChangeCategory = parseTypeChange(change.message);
      switch (argumentTypeChangeCategory) {
        case FieldTypeChangeCategory.OPTIONAL_TO_REQUIRED_SAME: {
          // SearchInput -> SearchInput!
          return {
            schemaChangeId: schemaCheckId,
            // if the argument is used and not passed (null),
            // but now that it is required, its breaking
            path: path.slice(1), // The path to the updated argument e.g. 'engineer.name' of the type names
            typeName: path[0],
            fieldName: path[2],
            isArgument: true,
            isNull: true,
          };
        }
        case FieldTypeChangeCategory.OPTIONAL_TO_REQUIRED_DIFFERENT: {
          // SearchInput -> String!
          // in this case, all the ops which have this argument are breaking
          return {
            schemaChangeId: schemaCheckId,
            path: path.slice(1), // The path to the updated argument e.g. 'engineer.name' of the type names
            typeName: path[0],
            fieldName: path[2],
            isArgument: true,
          };
        }
        case FieldTypeChangeCategory.REQUIRED_TO_REQUIRED_DIFFERENT: {
          // SearchInput! -> String!
          // in this case, all the ops which have this argument are breaking
          return {
            schemaChangeId: schemaCheckId,
            path: path.slice(1), // The path to the updated argument e.g. 'engineer.name' of the type names
            typeName: path[0],
            fieldName: path[2],
            isArgument: true,
          };
        }
        case FieldTypeChangeCategory.OPTIONAL_TO_OPTIONAL_DIFFERENT: {
          // SearchInput -> String
          // in this case, any ops which use the argument and are not null are breaking
          return {
            schemaChangeId: schemaCheckId,
            path: path.slice(1), // The path to the updated argument e.g. 'engineer.name' of the type names
            typeName: path[0],
            fieldName: path[2],
            isArgument: true,
            isNull: false,
          };
        }
        default: {
          throw new Error(`Unsupported argument type change category: ${argumentTypeChangeCategory}`);
        }
      }
    }

    // Only when a required argument is added
    case ChangeType.FieldArgumentAdded: {
      // in this case, all the ops which have this argument are breaking
      return {
        schemaChangeId: schemaCheckId,
        // e.g. if the path recieved is 'Query.employee.a', the path should be ['employee'] as its new field or it has changed the type of the argument, we check the usage of the operation.
        path: path.slice(1, 2),
        typeName: path[0],
      };
    }
    case ChangeType.FieldArgumentRemoved: {
      const isRequired = parseArgumentRemoval(change.message);
      if (isRequired) {
        // in this case, all the ops which use this argument are breaking
        return {
          schemaChangeId: schemaCheckId,
          // e.g. if the path recieved is 'Query.employee.a', the path should be ['employee'] as its new field or it has changed the type of the argument, we check the usage of the operation.
          path: path.slice(1, 2),
          typeName: path[0],
        };
      } else {
        // in this case, any ops which use the argument and are not null are breaking
        return {
          schemaChangeId: schemaCheckId,
          path: path.slice(1), // The path to the updated argument e.g. 'engineer.name' of the type names
          typeName: path[0],
          isArgument: true,
          isNull: false,
        };
      }
    }
  }
  // no return to enforce that all cases are handled
}
