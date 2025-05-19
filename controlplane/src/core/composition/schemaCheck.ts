import { ChangeType, CriticalityLevel, diff, TypeOfChangeType } from '@graphql-inspector/core';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GraphQLSchema } from 'graphql';
import { buildSchema } from './composition.js';

export interface SchemaDiff {
  message: string;
  changeType: TypeOfChangeType;
  // path is the path to the field or type that changed
  path: string;
  isBreaking: boolean;
}

export interface GetDiffBetweenGraphsSuccess {
  kind: 'success';
  changes: SchemaDiff[];
  breakingChanges: SchemaDiff[];
  nonBreakingChanges: SchemaDiff[];
}

export interface GetDiffBetweenGraphsFailure {
  kind: 'failure';
  error?: Error;
  errorCode: EnumStatusCode;
  errorMessage?: string;
}

export type GetDiffBetweenGraphsResult = GetDiffBetweenGraphsSuccess | GetDiffBetweenGraphsFailure;

export async function getSchemaDiff(oldSchemaSDL: GraphQLSchema, newSchemaSDL: GraphQLSchema): Promise<SchemaDiff[]> {
  const changes = await diff(oldSchemaSDL, newSchemaSDL);
  return changes.map((change) => {
    return {
      message: change.message,
      changeType: change.type,
      path: change.path ?? '',
      isBreaking:
        change.criticality.level === CriticalityLevel.Breaking ||
        // We consider enum value changes as breaking changes because it is common to use enums in switch statements
        // and if a value is removed or added, the switch statement will not be exhaustive anymore and might
        // lead to unexpected behavior.
        change.type === ChangeType.EnumValueRemoved ||
        change.type === ChangeType.EnumValueAdded,
    };
  });
}

export async function getDiffBetweenGraphs(
  oldSchemaSDL: string,
  newSchemaSDL: string,
  routerCompatibilityVersion: string,
): Promise<GetDiffBetweenGraphsResult> {
  try {
    let oldSchema: GraphQLSchema = new GraphQLSchema({});
    let newSchema: GraphQLSchema = new GraphQLSchema({});
    if (oldSchemaSDL) {
      const result = buildSchema(oldSchemaSDL, true, routerCompatibilityVersion);
      if (result.success) {
        oldSchema = result.schema;
      }
    }

    if (newSchemaSDL.length > 0) {
      const result = buildSchema(newSchemaSDL, true, routerCompatibilityVersion);
      if (!result.success) {
        return {
          kind: 'failure',
          error: new Error(result.errors.map((e) => e.toString()).join('\n')),
          errorCode: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
          errorMessage: result.errors.map((e) => e.toString()).join('\n'),
        };
      }
      newSchema = result.schema;
    }

    const schemaChanges = await getSchemaDiff(oldSchema, newSchema);

    const breakingChanges = schemaChanges.filter((change) => change.isBreaking);

    const breakingSchemaChanges: SchemaDiff[] = breakingChanges.map((breakingChange) => {
      return {
        message: breakingChange.message,
        changeType: breakingChange.changeType,
        path: breakingChange.path,
        isBreaking: true,
      };
    });

    const nonBreakingChanges = schemaChanges.filter((change) => !change.isBreaking);

    const nonBreakingSchemaChanges: SchemaDiff[] = nonBreakingChanges.map((nonBreakingChange) => {
      return {
        message: nonBreakingChange.message,
        changeType: nonBreakingChange.changeType,
        path: nonBreakingChange.path,
        isBreaking: false,
      };
    });

    return {
      kind: 'success',
      changes: schemaChanges,
      breakingChanges: breakingSchemaChanges,
      nonBreakingChanges: nonBreakingSchemaChanges,
    };
  } catch (error: any) {
    return {
      kind: 'failure',
      error: new Error(`Could not find diff between graphs: ${error}`),
      errorCode: EnumStatusCode.ERR_SUBGRAPH_CHECK_FAILED,
    };
  }
}
