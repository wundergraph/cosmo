import { ClickHouseClient } from '../clickhouse/index.js';
import { SchemaDiff } from '../composition/schemaCheck.js';
import { SchemaCheckChangeAction } from '../../db/models.js';

export interface InspectorSchemaChange {
  schemaChangeId: string;
  typeName: string;
  namedType?: string;
  fieldName?: string;
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
}

export class SchemaUsageTrafficInspector {
  constructor(private client: ClickHouseClient) {}

  /**
   * Inspect the usage of a schema change in the last X days on real traffic and return the
   * affected operations.
   */
  public async inspect(
    changes: InspectorSchemaChange[],
    filter: InspectorFilter,
  ): Promise<Map<string, InspectorOperationResult[]>> {
    const results: Map<string, InspectorOperationResult[]> = new Map();

    for (const change of changes) {
      let where: string[] = [];
      // Only for enum value changes
      if (change.namedType) {
        where.push(`NamedType = '${change.namedType}'`);
      }
      if (change.typeName) {
        where.push(`hasAny(TypeNames, ['${change.typeName}'])`);
        // fieldName can be empty if a type was removed
        if (change.fieldName) {
          where.push(`FieldName = '${change.fieldName}'`);
        }
      }

      const query = `
        SELECT OperationHash as operationHash,
               last_value(OperationType) as operationType,
               last_value(OperationName) as operationName,
               min(toUnixTimestamp(Timestamp)) as firstSeen,
               max(toUnixTimestamp(Timestamp)) as lastSeen
        FROM ${this.client.database}.gql_metrics_schema_usage_5m_90d
        WHERE
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
        }));

        if (ops.length > 0) {
          results.set(change.schemaChangeId, [...(results.get(change.schemaChangeId) || []), ...ops]);
        }
      }
    }

    return results;
  }

  /**
   * Check if a schema change is fully inspectable.
   * Fully inspectable means that we can translate the schema change to an inspector change.
   * If this is not given, we add the risk to release breaking changes that are not covered by the traffic analysis.
   */
  private isInspectable(schemaChanges: SchemaDiff[]): boolean {
    return schemaChanges.every((change) => {
      switch (change.changeType) {
        case 'INPUT_FIELD_TYPE_CHANGED':
        case 'INPUT_FIELD_REMOVED':
        case 'INPUT_FIELD_DEFAULT_VALUE_CHANGED':
        case 'FIELD_ARGUMENT_REMOVED':
        case 'FIELD_ARGUMENT_TYPE_CHANGED':
        case 'FIELD_ARGUMENT_DEFAULT_CHANGED':
        case 'DIRECTIVE_REMOVED':
        case 'DIRECTIVE_ARGUMENT_REMOVED':
        case 'DIRECTIVE_ARGUMENT_DEFAULT_VALUE_CHANGED':
        case 'DIRECTIVE_LOCATION_REMOVED':
          return false;
        default:
          return true;
      }
    });
  }

  /**
   * Convert schema changes to inspector changes.
   */
  public schemaChangesToInspectorChanges(
    schemaChanges: SchemaDiff[],
    schemaCheckActions: SchemaCheckChangeAction[],
  ): {
    inspectable: boolean;
    changes: InspectorSchemaChange[];
  } {
    const inspectable = this.isInspectable(schemaChanges);
    if (!inspectable) {
      return { inspectable: false, changes: [] };
    }

    const operations = schemaChanges
      .map((change) => {
        const path = change.path.split('.');
        // find the schema check action that matches the change
        const schemaCheckAction = schemaCheckActions.find(
          (action) => action.path === change.path && action.changeType === change.changeType,
        );

        // there must be a schema check action for every change otherwise it is a bug
        if (!schemaCheckAction) {
          return null;
        }

        switch (change.changeType) {
          // When a type is removed we know the exact type name e.g. 'Engineer'. We have no field name.
          case 'TYPE_REMOVED':
          case 'UNION_MEMBER_REMOVED':
          case 'OBJECT_TYPE_INTERFACE_REMOVED':
            return {
              schemaChangeId: schemaCheckAction.id,
              typeName: path[0],
            } as InspectorSchemaChange;
          // When a field is removed or the type has changed in a breaking way,
          // we know the exact type and field name e.g. 'Engineer.name'
          case 'FIELD_REMOVED':
          case 'FIELD_TYPE_CHANGED':
            return {
              schemaChangeId: schemaCheckAction.id,
              typeName: path[0],
              fieldName: path[1],
            } as InspectorSchemaChange;
          // When an enum value is added or removed, we only know the exact node type
          // e.g. 'Department' not the enum value. This is fine because any change to an enum value is breaking.
          case 'ENUM_VALUE_ADDED':
          case 'ENUM_VALUE_REMOVED':
            return {
              schemaChangeId: schemaCheckAction.id,
              namedType: path[0],
            } as InspectorSchemaChange;
          default:
            // ignore all other changes
            return null;
        }
      })
      .filter((change) => change !== null) as InspectorSchemaChange[];

    return { inspectable: true, changes: operations };
  }
}

export function collectOperationUsageStats(inspectorResult: InspectorOperationResult[]) {
  return {
    totalOperations: inspectorResult.length,
    firstSeenAt: inspectorResult
      .reduce((acc, curr) => (acc < new Date(curr.firstSeenAt) ? acc : new Date(curr.firstSeenAt)), new Date())
      .toUTCString(),
    lastSeenAt: inspectorResult
      .reduce((acc, curr) => (acc > new Date(curr.lastSeenAt) ? acc : new Date(curr.lastSeenAt)), new Date())
      .toUTCString(),
  };
}
