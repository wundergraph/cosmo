import { describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ANALYTICS_DATASETS } from '@wundergraph/cosmo-shared';
import { registerAnalyticsTools } from '../../../src/commands/mcp/analytics/server.js';
import { fakeContext } from './fake-context.js';

const setup = () => {
  const fake = fakeContext({
    getAnalyticsCapabilities: () => ({
      response: { code: EnumStatusCode.OK },
      principalType: 'user',
      datasets: ['spans'],
      retention: [],
      warnings: [],
    }),
  });
  registerAnalyticsTools(fake.ctx);
  return fake;
};

describe('registerAnalyticsTools', () => {
  test('registers every analytics tool, all read-only', () => {
    const { tools } = setup();

    expect([...tools.keys()].sort()).toEqual([
      'analyze_spans',
      'compare_periods',
      'get_analytics_context',
      'get_change_timeline',
      'get_check_impact',
      'get_error_breakdown',
      'get_field_usage',
      'get_graph_overview',
      'get_operation',
      'get_subgraph_overview',
      'get_trace',
      'get_usage_and_quota',
      'list_clients',
      'list_dimension_values',
      'list_operations',
      'list_routers',
      'query_analytics',
      'search_operation_documents',
      'search_traces',
    ]);
    for (const tool of tools.values()) {
      expect(tool.config.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  test('serves the guide, the dataset catalog and the caller context as resources', async () => {
    const { resources } = setup();

    expect([...resources.keys()]).toEqual([
      'cosmo://analytics/guide',
      'cosmo://analytics/datasets',
      'cosmo://analytics/context',
    ]);
    const datasets = (await resources.get('cosmo://analytics/datasets')!(new URL('cosmo://analytics/datasets')))
      .contents[0].text;
    const headings = datasets
      .split('\n')
      .filter((line: string) => line.startsWith('## '))
      .map((line: string) => line.slice(3));
    expect(headings).toEqual(ANALYTICS_DATASETS.map((dataset) => dataset.name));
    const context = JSON.parse(
      (await resources.get('cosmo://analytics/context')!(new URL('cosmo://analytics/context'))).contents[0].text,
    );
    expect([context.principalType, context.datasets, context.organizationSlug, context.authMode]).toEqual([
      'user',
      ['spans'],
      'acme',
      'user',
    ]);
  });

  test('offers the investigation prompts, each naming the graph', () => {
    const { prompts } = setup();

    expect([...prompts.keys()]).toEqual([
      'investigate-slow-operation',
      'incident-triage',
      'deprecation-cleanup-report',
      'unused-schema-report',
      'client-adoption-report',
      'release-impact',
      'weekly-graph-health',
    ]);
    const firstLine = (name: string, args: Record<string, string>) =>
      prompts.get(name)!(args).messages[0].content.text.split('\n')[0];
    expect(
      Object.fromEntries(
        [...prompts.keys()].map((name) => [name, firstLine(name, { graph: 'shop', operation: 'GetOrder' })]),
      ),
    ).toEqual({
      'investigate-slow-operation':
        'Investigate why operation "GetOrder" on graph shop (namespace default) is slow over 24h.',
      'incident-triage': 'Triage an incident on graph shop (namespace default) in the last 6 hours.',
      'deprecation-cleanup-report': 'Report deprecated-field usage on graph shop (namespace default) over 7d.',
      'unused-schema-report': 'Find schema elements of graph shop (namespace default) that were not used recently.',
      'client-adoption-report': 'Report client adoption on graph shop (namespace default) over 7d.',
      'release-impact': 'Assess the impact of the most recent release on graph shop (namespace default).',
      'weekly-graph-health': 'Write a weekly health report for graph shop (namespace default).',
    });
    expect(
      firstLine('investigate-slow-operation', { graph: 'shop', namespace: 'prod', operation: 'GetOrder', range: '7d' }),
    ).toBe('Investigate why operation "GetOrder" on graph shop (namespace prod) is slow over 7d.');
  });
});
