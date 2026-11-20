import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { studioUrl } from '../links.js';
import { nsToMs, truncateValue } from '../query.js';

const SUBGRAPH = 'wg.subgraph.name';

export function registerGetTraceTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'get_trace',
    {
      title: 'Get trace',
      description: [
        'One trace (from search_traces). The default summary answers where the time went and what failed:',
        'time per router phase (parse, normalize, validate, plan, execute), time per subgraph (all fetches and the part on the critical path),',
        'the critical path, and every error (span status, exceptions, downstream subgraph error codes), plus a compact span list.',
        'detail "full" returns every span with all its attributes (custom header attributes and GraphQL variables included when the router exports them), events and resource attributes.',
        'Values over 2 KB are truncated unless full is true.',
      ].join(' '),
      inputSchema: {
        ...graphInput,
        traceId: z.string().describe('Trace ID.'),
        spanId: z.string().optional().describe('Only this span and its descendants. Default: the whole trace.'),
        detail: z.enum(['summary', 'full']).default('summary'),
        full: z.boolean().default(false).describe('Return attribute values in full, without truncation.'),
        maxSpans: z.number().int().positive().max(2000).optional().describe('At most this many spans (default 1000).'),
      },
    },
    async (input, headers) => {
      const graph = await ctx.client.getFederatedGraphByName(
        { name: input.graph, namespace: input.namespace, includeMetrics: false },
        { headers },
      );
      const graphError = checkResponse(graph, 'Graph lookup');
      if (graphError || !graph.graph) {
        return fail(graphError ?? 'Graph not found or you have no access.');
      }

      const resp = await ctx.client.getTrace(
        {
          id: input.traceId,
          spanId: input.spanId ?? '',
          federatedGraphId: graph.graph.id,
          maxSpans: input.maxSpans,
          includeSummary: true,
        },
        { headers },
      );
      const error = checkResponse(resp, 'Trace');
      if (error) {
        return fail(error);
      }

      let truncatedValues = false;
      const cut = (value: string) => {
        const result = truncateValue(value, input.full);
        truncatedValues ||= result.truncated;
        return result.value;
      };
      const cutMap = (values: Record<string, string>) =>
        Object.fromEntries(Object.entries(values).map(([key, value]) => [key, cut(value)]));

      const spans = resp.spans.map((span) => {
        const compact = {
          spanId: span.spanID,
          parentSpanId: span.parentSpanID,
          spanName: span.spanName,
          spanKind: span.spanKind,
          serviceName: span.serviceName,
          subgraph: span.rawAttributes[SUBGRAPH] ?? '',
          durationMs: nsToMs(span.duration),
          offsetMs: resp.spans.length > 0 ? nsToMs(span.timestamp - resp.spans[0].timestamp) : 0,
          statusCode: span.statusCode,
          statusMessage: cut(span.statusMessage),
        };
        if (input.detail === 'summary') {
          return compact;
        }
        return {
          ...compact,
          attributes: cutMap(span.rawAttributes),
          resourceAttributes: span.resourceAttributes,
          events: span.events.map((event) => ({
            name: event.name,
            offsetMs: nsToMs(event.timestamp - span.timestamp),
            attributes: cutMap(event.attributes),
          })),
        };
      });

      const summary = resp.summary && {
        durationMs: nsToMs(resp.summary.durationNs),
        spanCount: resp.summary.spanCount,
        phases: resp.summary.phases.map((phase) => ({
          name: phase.name,
          count: phase.count,
          totalMs: nsToMs(phase.totalDurationNs),
        })),
        subgraphs: resp.summary.subgraphs.map((subgraph) => ({
          subgraph: subgraph.subgraphName,
          fetches: subgraph.fetches,
          totalMs: nsToMs(subgraph.totalDurationNs),
          maxMs: nsToMs(subgraph.maxDurationNs),
          criticalPathMs: nsToMs(subgraph.criticalPathNs),
          errors: subgraph.errors,
        })),
        criticalPath: resp.summary.criticalPath.map((segment) => ({
          spanId: segment.spanId,
          spanName: segment.spanName,
          subgraph: segment.subgraphName,
          selfMs: nsToMs(segment.selfDurationNs),
        })),
        errors: resp.summary.errors.map((e) => ({
          spanId: e.spanId,
          spanName: e.spanName,
          subgraph: e.subgraphName,
          kind: e.kind,
          code: e.code,
          message: cut(e.message),
        })),
      };

      const warnings: string[] = [];
      if (spans.length === 0) {
        warnings.push('No trace with this ID within your tracing retention.');
      }
      if (resp.truncated) {
        warnings.push(
          `Only the first ${spans.length} of ${resp.totalSpans} spans are included; raise maxSpans for more.`,
        );
      }
      if (resp.summary && !resp.summary.eventsAvailable && spans.length > 0) {
        warnings.push(
          'This trace was stored before events were kept: exceptions and downstream error codes are not available.',
        );
      }
      if (truncatedValues) {
        warnings.push('Some values were truncated to 2 KB; repeat with full: true for the complete values.');
      }

      return ok(
        { summary, spans },
        {
          graphs: [{ name: input.graph, namespace: input.namespace }],
          completeness: 'sampled',
          now: ctx.now().toISOString(),
          truncated: resp.truncated || truncatedValues,
          warnings,
          studioUrl: studioUrl(ctx.webURL, await ctx.getOrgSlug(), input.namespace, input.graph, 'traces', {
            traceID: input.traceId,
          }),
        },
      );
    },
  );
}
