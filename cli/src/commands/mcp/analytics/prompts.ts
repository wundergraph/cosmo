import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const graphArgs = {
  graph: z.string().describe('Federated graph name.'),
  namespace: z.string().optional().describe('Namespace (default "default").'),
};

const ns = (namespace?: string) => namespace || 'default';

const prompt = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] });

/**
 * Investigation workflows as prompts: each names the tools and the order that answer a common question well. They
 * only ever call the read-only analytics tools.
 */
export function registerAnalyticsPrompts(server: McpServer) {
  server.registerPrompt(
    'investigate-slow-operation',
    {
      title: 'Investigate a slow operation',
      description: 'Why is an operation slow: trend, clients, subgraphs, phases and example traces.',
      argsSchema: { ...graphArgs, operation: z.string().describe('Operation name.'), range: z.string().optional() },
    },
    ({ graph, namespace, operation, range }) =>
      prompt(
        `Investigate why operation "${operation}" on graph ${graph} (namespace ${ns(namespace)}) is slow over ${range || '24h'}.
1. get_analytics_context for retention and sampling.
2. query_analytics on operation_metrics filtered to the operation: latencyP50/P95/P99, latencyMax and requests by time bucket, and by clientName/clientVersion.
3. compare_periods for the same operation to see whether it regressed.
4. query_analytics on subgraph_metrics filtered to the operation, by subgraph: requests (fetches), latencyAvg, latencyP95, latencySum.
5. analyze_spans for the operation, grouped by spanName, to see which router phase or fetch dominates.
6. search_traces for the slowest examples (sort slowest), then get_trace on one or two for the critical path.
Report the effective window, which numbers are complete vs sampled, and quote the observed sampling ratio.`,
      ),
  );

  server.registerPrompt(
    'incident-triage',
    {
      title: 'Incident triage',
      description: 'What broke, when, for whom and where, for a time window.',
      argsSchema: { ...graphArgs, from: z.string().optional(), to: z.string().optional() },
    },
    ({ graph, namespace, from, to }) =>
      prompt(
        `Triage an incident on graph ${graph} (namespace ${ns(namespace)})${from && to ? ` between ${from} and ${to}` : ' in the last 6 hours'}.
1. query_analytics on operation_metrics by 5m time bucket: requests, errors, errorRate, latencyP95 — find when it started.
2. get_error_breakdown (by message, then by subgraph) for what fails and example traces.
3. query_analytics on subgraph_metrics by subgraph: errorRate and latencyP95.
4. get_change_timeline around the start: did a composition or flag change precede it?
5. get_trace on an example failing trace for downstream error codes.
Summarize: start time, blast radius (operations, clients, share of traffic), likely cause, evidence links.`,
      ),
  );

  server.registerPrompt(
    'deprecation-cleanup-report',
    {
      title: 'Deprecation cleanup report',
      description: 'Which deprecated fields are still used, by whom, and what to fix first.',
      argsSchema: { ...graphArgs, range: z.string().optional() },
    },
    ({ graph, namespace, range }) =>
      prompt(
        `Report deprecated-field usage on graph ${graph} (namespace ${ns(namespace)}) over ${range || '7d'}.
Use get_field_usage for each deprecated field you know of (or list_operations with deprecated-field flags), and query_analytics on field_usage grouped by fieldName, clientName and operationName for the fields in question.
For each field: usages, operations, clients and versions, last seen. Never call a field unused or safe to remove when a result is approximate, and always tell the user to run a schema check (wgc subgraph check) before removing anything.`,
      ),
  );

  server.registerPrompt(
    'unused-schema-report',
    {
      title: 'Unused schema report',
      description: 'Fields, arguments and inputs with no recent usage.',
      argsSchema: { ...graphArgs, type: z.string().optional().describe('Limit to one type.') },
    },
    ({ graph, namespace, type }) =>
      prompt(
        `Find schema elements of graph ${graph} (namespace ${ns(namespace)})${type ? ` on type ${type}` : ''} that were not used recently.
Use query_analytics on schema_presence grouped by typeName and fieldName (with kind) to list what was used and when it was last seen, over the longest window your retention allows (get_analytics_context).
Compare with the schema you know; anything absent was not used in the window. Usage data excludes introspection and does not track enum values. Recommend running a schema check before removing anything.`,
      ),
  );

  server.registerPrompt(
    'client-adoption-report',
    {
      title: 'Client adoption report',
      description: 'Client versions in use, their traffic share over time, and stragglers.',
      argsSchema: { ...graphArgs, client: z.string().optional(), range: z.string().optional() },
    },
    ({ graph, namespace, client, range }) =>
      prompt(
        `Report client adoption on graph ${graph} (namespace ${ns(namespace)}) over ${range || '7d'}${client ? ` for client ${client}` : ''}.
1. list_clients for every client and version with requests, errors and first/last seen.
2. query_analytics on operation_metrics by clientVersion with timeBucket 1d for the adoption curve.
3. Flag versions with high error rates and registered clients without traffic.`,
      ),
  );

  server.registerPrompt(
    'release-impact',
    {
      title: 'Release impact',
      description: 'Did the last composition change latency, errors or planning time?',
      argsSchema: { ...graphArgs },
    },
    ({ graph, namespace }) =>
      prompt(
        `Assess the impact of the most recent release on graph ${graph} (namespace ${ns(namespace)}).
1. get_change_timeline for the last composition and its schema changes.
2. compare_periods on operation_metrics with the window after the composition vs the same length before it (baselineFrom/baselineTo), minVolume 50, sorted by latencyP95DeltaPct and errorRateDelta.
3. query_analytics on planning_metrics by composition: plan-cache misses spike after a publish.
4. query_analytics on router_runtime by serviceInstanceId and configVersion: firstSeen shows when each router picked up the new config, and lists routers still on the old one.`,
      ),
  );

  server.registerPrompt(
    'weekly-graph-health',
    {
      title: 'Weekly graph health',
      description: 'A weekly health report: traffic, errors, latency, subgraphs, clients and changes.',
      argsSchema: { ...graphArgs },
    },
    ({ graph, namespace }) =>
      prompt(
        `Write a weekly health report for graph ${graph} (namespace ${ns(namespace)}).
Use get_graph_overview (range 7d), compare_periods (7d vs previous 7d) for the top operations, query_analytics on subgraph_metrics by subgraph, list_clients, get_error_breakdown and get_change_timeline (7d).
Sections: traffic, errors, latency (note the 10s histogram cap), subgraphs, clients, changes, and three recommendations. State the effective window and what is sampled.`,
      ),
  );
}
