import { buildASTSchema, parse } from 'graphql';
import { describe, expect, test, vi } from 'vitest';
import { FederatedGraphRepository } from '../src/core/repositories/FederatedGraphRepository.js';
import { SubgraphRepository } from '../src/core/repositories/SubgraphRepository.js';
import { UsageRepository } from '../src/core/repositories/analytics/UsageRepository.js';
import SchemaGraphPruner from '../src/core/services/SchemaGraphPruner.js';
import { FederatedGraphDTO, SchemaGraphPruningDTO, SubgraphDTO } from '../src/types/index.js';

type GracePeriodField = { path: string; isDeprecated: boolean };

const graph = (id: string) => ({ id, name: `graph-${id}` }) as FederatedGraphDTO;

const unusedFieldsRule = (schemaUsageCheckPeriodInDays = 7): SchemaGraphPruningDTO => ({
  ruleName: 'UNUSED_FIELDS',
  severity: 'error',
  gracePeriodInDays: 7,
  schemaUsageCheckPeriodInDays,
});

const deprecatedFieldsRule = (schemaUsageCheckPeriodInDays = 7): SchemaGraphPruningDTO => ({
  ruleName: 'DEPRECATED_FIELDS',
  severity: 'error',
  gracePeriodInDays: 7,
  schemaUsageCheckPeriodInDays,
});

const runPruneCheck = async ({
  sdl,
  graphs = [graph('first')],
  usedFieldPathsByGraphId = {},
  gracePeriodFields = [],
  rules,
}: {
  sdl: string;
  graphs?: FederatedGraphDTO[];
  usedFieldPathsByGraphId?: Record<string, string[]>;
  gracePeriodFields?: GracePeriodField[];
  rules: SchemaGraphPruningDTO[];
}) => {
  const getUsedFieldPaths = vi.fn(({ federatedGraphId }: { federatedGraphId: string; rangeInHours: number }) =>
    Promise.resolve(usedFieldPathsByGraphId[federatedGraphId] ?? []),
  );
  const pruner = new SchemaGraphPruner(
    { bySubgraphLabels: () => Promise.resolve(graphs) } as unknown as FederatedGraphRepository,
    {
      getSubgraphFieldsInGracePeriod: ({ onlyDeprecated }: { onlyDeprecated?: boolean }) =>
        Promise.resolve(gracePeriodFields.filter((f) => !onlyDeprecated || f.isDeprecated)),
    } as unknown as SubgraphRepository,
    { getUsedFieldPaths } as unknown as UsageRepository,
    buildASTSchema(parse(sdl), { assumeValid: true, assumeValidSDL: true }),
  );

  const issues = await pruner.schemaGraphPruneCheck({
    subgraph: { id: 'subgraph', namespaceId: 'namespace', labels: [], schemaSDL: sdl } as unknown as SubgraphDTO,
    graphPruningConfigs: rules,
    organizationId: 'organization',
    rangeInDays: 7,
    updatedFields: [],
    removedFields: [],
  });

  return { errors: issues.errors, getUsedFieldPaths };
};

describe('SchemaGraphPruner', () => {
  test('Should report unused fields against each federated graph’s own usage', async () => {
    const { errors } = await runPruneCheck({
      sdl: 'type Query { a: String b: String }',
      graphs: [graph('first'), graph('second')],
      usedFieldPathsByGraphId: { first: ['Query.a'], second: ['Query.b'] },
      rules: [unusedFieldsRule()],
    });

    expect(errors.map((e) => [e.federatedGraphName, e.fieldPath])).toEqual([
      ['graph-first', 'Query.b'],
      ['graph-second', 'Query.a'],
    ]);
  });

  test('Should query used fields once per federated graph when the rules share a range', async () => {
    const { getUsedFieldPaths } = await runPruneCheck({
      sdl: 'type Query { a: String @deprecated }',
      graphs: [graph('first'), graph('second')],
      rules: [unusedFieldsRule(7), deprecatedFieldsRule(7)],
    });

    expect(getUsedFieldPaths.mock.calls.map(([args]) => args.federatedGraphId)).toEqual(['first', 'second']);
  });

  test('Should query used fields once per range when the rules use different ranges', async () => {
    const { getUsedFieldPaths } = await runPruneCheck({
      sdl: 'type Query { a: String @deprecated }',
      rules: [unusedFieldsRule(7), deprecatedFieldsRule(30)],
    });

    expect(getUsedFieldPaths.mock.calls.map(([args]) => args.rangeInHours)).toEqual([7 * 24, 30 * 24]);
  });

  test('Should report unused fields only once their grace period has ended', async () => {
    const { errors } = await runPruneCheck({
      sdl: 'type Query { a: String b: String }',
      gracePeriodFields: [{ path: 'Query.b', isDeprecated: false }],
      rules: [unusedFieldsRule()],
    });

    expect(errors.map((e) => e.fieldPath)).toEqual(['Query.a']);
  });

  test('Should report deprecated fields only once their deprecation grace period has ended', async () => {
    const { errors } = await runPruneCheck({
      sdl: 'type Query { a: String @deprecated b: String @deprecated }',
      gracePeriodFields: [{ path: 'Query.a', isDeprecated: true }],
      rules: [deprecatedFieldsRule()],
    });

    expect(errors.map((e) => e.fieldPath)).toEqual(['Query.b']);
  });

  test('Should report unused input object fields', async () => {
    const { errors } = await runPruneCheck({
      sdl: 'input Filter { x: String y: String } type Query { search(filter: Filter): String }',
      usedFieldPathsByGraphId: { first: ['Query.search', 'Filter.x'] },
      rules: [unusedFieldsRule()],
    });

    expect(errors.map((e) => e.fieldPath)).toEqual(['Filter.y']);
  });

  test('Should report unused interface fields', async () => {
    const { errors } = await runPruneCheck({
      sdl: 'interface Node { id: ID name: String } type Query { node: Node }',
      usedFieldPathsByGraphId: { first: ['Query.node', 'Node.id'] },
      rules: [unusedFieldsRule()],
    });

    expect(errors.map((e) => e.fieldPath)).toEqual(['Node.name']);
  });
});
