import { ChangeType } from '@graphql-inspector/core';
import { ClickHouseClient } from '../clickhouse/index.js';
import { SchemaDiff } from '../composition/schemaCheck.js';
import { SchemaCheckChangeAction } from '../../db/models.js';

export interface InspectorSchemaChange {
  schemaChangeId: string;
  typeName?: string;
  namedType?: string;
  fieldName?: string;
  path?: string[];
  isInput?: boolean;
  isArgument?: boolean;
}

export interface InspectorFilter {
  federatedGraphId: string;
  organizationId: string;
  daysToConsider: number;
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
    case ChangeType.InputFieldTypeChanged:
    case ChangeType.InputFieldRemoved:
    case ChangeType.InputFieldAdded: {
      return {
        schemaChangeId: schemaCheckId,
        fieldName: path[1],
        typeName: path[0],
        isInput: true,
      };
    }
    // 1. When an argument has changed, we know the exact path to the argument e.g. 'Query.engineer.id'
    // and the type name e.g. 'Query'
    case ChangeType.FieldArgumentRemoved:
    case ChangeType.FieldArgumentAdded: // Only when a required argument is added
    case ChangeType.FieldArgumentTypeChanged: {
      return {
        schemaChangeId: schemaCheckId,
        path: path.slice(1), // The path to the updated argument e.g. 'engineer.name' of the type names
        typeName: path[0], // Enclosing type e.g. 'Query' or 'Engineer' when the argument is on a field of type Engineer
        isArgument: true,
      };
    }
  }
  // no return to enforce that all cases are handled
}
