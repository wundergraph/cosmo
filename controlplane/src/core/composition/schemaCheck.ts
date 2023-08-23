import { CriticalityLevel, diff, Change } from '@graphql-inspector/core';
import { SchemaChange } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { GraphQLSchema } from 'graphql';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common_pb';
import { buildSchema } from './composition.js';

export interface GetDiffBetweenGraphsSuccess {
  kind: 'success';
  changes: SchemaChange[];
  breakingChanges: SchemaChange[];
  nonBreakingChanges: SchemaChange[];
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

    const changes: Change[] = await diff(oldSchema, newSchema);

    const schemaChanges: SchemaChange[] = changes.map((change) => {
      return {
        message: change.message,
        changeType: change.type,
        path: change.path,
        isBreaking: change.criticality.level !== CriticalityLevel.NonBreaking,
      } as SchemaChange;
    });

    const breakingChanges: Change[] = changes.filter(
      (change) =>
        change.criticality.level === CriticalityLevel.Breaking ||
        change.criticality.level === CriticalityLevel.Dangerous,
    );
    const nonBreakingChanges: Change[] = changes.filter(
      (change) => change.criticality.level === CriticalityLevel.NonBreaking,
    );

    const breakingSchemaChanges: SchemaChange[] = breakingChanges.map((breakingChange) => {
      return {
        message: breakingChange.message,
        changeType: breakingChange.type,
        path: breakingChange.path,
        isBreaking: true,
      } as SchemaChange;
    });

    const nonBreakingSchemaChanges: SchemaChange[] = nonBreakingChanges.map((nonBreakingChange) => {
      return {
        message: nonBreakingChange.message,
        changeType: nonBreakingChange.type,
        path: nonBreakingChange.path,
        isBreaking: false,
      } as SchemaChange;
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
