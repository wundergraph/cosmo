import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { AnalyticsGraphRef, AnalyticsTimeWindow } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { AnalyticsDatasetDescriptor } from '@wundergraph/cosmo-shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AuthContext, FeatureIds } from '../../../types/index.js';
import type { ClickHouseClient } from '../../clickhouse/index.js';
import { OutOfRetentionError, PublicError } from '../../errors/errors.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { CompiledFilter } from '../../repositories/analytics/query/compiler.js';
import { AnalyticsQueryEngine, type EngineGraph, type EngineScope } from '../../repositories/analytics/query/engine.js';
import { PostgresAnalyticsInventory } from '../../repositories/analytics/query/inventory.js';
import {
  grainSecondsOf,
  resolveWindow,
  retentionStartOf,
  type ResolvedWindow,
  type Window,
} from '../../repositories/analytics/query/window.js';
import type { RouterOptions } from '../../routes.js';
import { toPublicError } from './proto.js';

/** What an analytics read resolves before it queries: which graphs, how far back the plan reaches, and the window. */

export const GRAPH_NOT_FOUND = 'Graph not found or you have no access.';

/**
 * Resolves the graphs of an analytics request inside the organization. An unknown graph and a graph the caller may not
 * read get the same answer, so the response never reveals that a graph exists.
 */
export async function resolveAnalyticsGraphs(input: {
  opts: RouterOptions;
  logger: FastifyBaseLogger;
  authContext: AuthContext;
  graphs: AnalyticsGraphRef[];
  allReadableGraphs: boolean;
}): Promise<EngineGraph[]> {
  const { opts, logger, authContext, graphs: refs, allReadableGraphs } = input;
  const repo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
  if (allReadableGraphs) {
    // Every graph of the organization, each checked on its own: the list query's RBAC filter drops graphs when namespace
    // and graph rules are combined.
    const graphs = await repo.list({ limit: 0, offset: 0 });
    const readable = graphs.filter((graph) => authContext.rbac.hasFederatedGraphReadAccess(graph));
    if (readable.length === 0) {
      throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, 'You have no access to any graph.');
    }
    return readable.map((graph) => ({ id: graph.id, name: graph.name, namespace: graph.namespace }));
  }
  if (refs.length === 0) {
    throw new PublicError(EnumStatusCode.ERR_BAD_REQUEST, 'Name at least one graph, or ask for all readable graphs.');
  }
  const resolved: EngineGraph[] = [];
  for (const ref of refs) {
    const graph = await repo.byName(ref.name, ref.namespace || 'default');
    if (!graph || !authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, GRAPH_NOT_FOUND);
    }
    if (!resolved.some((g) => g.id === graph.id)) {
      resolved.push({ id: graph.id, name: graph.name, namespace: graph.namespace });
    }
  }
  return resolved;
}

/** Graph filters narrow the graphs a query reads: the tenant predicate then holds only those graphs. */
export function applyGraphFilter(graphs: EngineGraph[], filters: CompiledFilter[]): EngineGraph[] {
  let result = graphs;
  for (const filter of filters) {
    if (filter.field !== 'graph') {
      continue;
    }
    const [first = ''] = filter.values;
    result = result.filter((graph) => {
      switch (filter.operator) {
        case 'eq':
        case 'in': {
          return filter.values.includes(graph.name);
        }
        case 'neq':
        case 'not_in': {
          return !filter.values.includes(graph.name);
        }
        case 'contains': {
          return graph.name.toLowerCase().includes(first.toLowerCase());
        }
        case 'starts_with': {
          return graph.name.startsWith(first);
        }
        default: {
          return true;
        }
      }
    });
  }
  return result;
}

/** Days the plan lets the organization read for `feature`, capped by how long the data is stored. */
export async function retentionDays(input: {
  opts: RouterOptions;
  logger: FastifyBaseLogger;
  organizationId: string;
  feature: FeatureIds;
  storageTtlDays: number;
}) {
  const orgRepo = new OrganizationRepository(input.logger, input.opts.db, input.opts.billingDefaultPlanId);
  const feature = await orgRepo.getFeature({ organizationId: input.organizationId, featureId: input.feature });
  return Math.min(feature?.limit ?? 7, input.storageTtlDays);
}

export function resolveAnalyticsWindow(input: {
  window: AnalyticsTimeWindow | undefined;
  descriptor: AnalyticsDatasetDescriptor;
  retentionDays: number;
  nowSeconds: number;
  defaultRangeHours?: number;
}): ResolvedWindow {
  let resolved: ResolvedWindow | null;
  try {
    resolved = resolveWindow({
      window: {
        rangeHours: input.window?.rangeHours,
        start: input.window?.start,
        end: input.window?.end,
      },
      retentionDays: input.retentionDays,
      nowSeconds: input.nowSeconds,
      grainSeconds: grainSecondsOf(input.descriptor.grain),
      defaultRangeHours: input.defaultRangeHours ?? 24,
    });
  } catch (error) {
    throw toPublicError(error);
  }
  if (!resolved) {
    throw new OutOfRetentionError();
  }
  return resolved;
}

export interface AnalyticsReadScope {
  /** The graphs the request reads, after its graph filters. */
  graphs: EngineGraph[];
  retentionDays: number;
  resolved: ResolvedWindow;
}

/** The graphs, retention and window of a read of one dataset, in the order every analytics read resolves them. */
export async function resolveAnalyticsScope(input: {
  opts: RouterOptions;
  logger: FastifyBaseLogger;
  authContext: AuthContext;
  graphs: AnalyticsGraphRef[];
  allReadableGraphs: boolean;
  /** Filters on `graph` narrow the graphs; the query applies the others. */
  filters: CompiledFilter[];
  descriptor: AnalyticsDatasetDescriptor;
  window: AnalyticsTimeWindow | undefined;
  nowSeconds: number;
  defaultRangeHours?: (retentionDays: number) => number;
}): Promise<AnalyticsReadScope> {
  const { opts, logger, authContext, descriptor, nowSeconds, allReadableGraphs, filters } = input;
  const graphs = applyGraphFilter(
    await resolveAnalyticsGraphs({
      opts,
      logger,
      authContext,
      graphs: input.graphs,
      allReadableGraphs,
    }),
    filters,
  );
  const retention = await retentionDays({
    opts,
    logger,
    organizationId: authContext.organizationId,
    feature: descriptor.retentionFeature,
    storageTtlDays: descriptor.storageTtlDays,
  });
  const resolved = resolveAnalyticsWindow({
    window: input.window,
    descriptor,
    retentionDays: retention,
    nowSeconds,
    defaultRangeHours: input.defaultRangeHours?.(retention),
  });
  return { graphs, retentionDays: retention, resolved };
}

/** The engine's view of a read: the organization, the graphs, the window it reads and how far back retention reaches. */
export const toEngineScope = (
  organizationId: string,
  scope: AnalyticsReadScope,
  window: Window,
  nowSeconds: number,
): EngineScope => ({
  organizationId,
  graphs: scope.graphs,
  window,
  retentionStart: retentionStartOf(nowSeconds, scope.retentionDays),
});

/** The query engine for one organization, with its Postgres inventory and the configured row budget. */
export const createAnalyticsEngine = (opts: RouterOptions, chClient: ClickHouseClient, organizationId: string) =>
  new AnalyticsQueryEngine(chClient, new PostgresAnalyticsInventory(opts.db, organizationId), {
    rowBudget: opts.analyticsQueryRowBudget,
  });
