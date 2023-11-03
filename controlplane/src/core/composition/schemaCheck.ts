import { Change, ChangeType, CriticalityLevel, diff } from '@graphql-inspector/core';
import { GraphQLSchema } from 'graphql';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { buildSchema } from './composition.js';

export interface SchemaDiff {
  message: string;
  changeType: ChangeType;
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

export async function getDiffBetweenGraphs(
  oldSchemaSDL: string,
  newSchemaSDL: string,
): Promise<GetDiffBetweenGraphsResult> {
  try {
    let oldSchema: GraphQLSchema = new GraphQLSchema({});
    let newSchema: GraphQLSchema = new GraphQLSchema({});
    if (oldSchemaSDL) {
      const { normalizationResult } = buildSchema(oldSchemaSDL);
      if (normalizationResult?.schema) {
        oldSchema = normalizationResult.schema;
      }
    }
    const { errors, normalizationResult } = buildSchema(newSchemaSDL);
    if (errors && errors.length > 0) {
      return {
        kind: 'failure',
        error: new Error(errors.map((e) => e.toString()).join('\n')),
        errorCode: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
        errorMessage: errors.map((e) => e.toString()).join('\n'),
      };
    }
    if (normalizationResult?.schema) {
      newSchema = normalizationResult.schema;
    }

    const changes: Change<ChangeType>[] = await diff(oldSchema, newSchema);

    const schemaChanges: SchemaDiff[] = changes.map((change) => {
      return {
        message: change.message,
        changeType: change.type,
        path: change.path ?? '',
        isBreaking: change.criticality.level === CriticalityLevel.Breaking,
      };
    });

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
