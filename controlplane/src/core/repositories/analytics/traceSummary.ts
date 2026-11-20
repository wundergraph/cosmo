/**
 * Summarizes one trace: time per router phase, time per subgraph (all fetches and the part on the critical path), the
 * critical path itself, and every error (span status, exception events, downstream subgraph errors).
 */

export interface SummarySpan {
  spanId: string;
  parentSpanId: string;
  spanName: string;
  /** Nanoseconds since the epoch. */
  start: bigint;
  durationNs: bigint;
  statusCode: string;
  statusMessage: string;
  attributes: Record<string, string>;
  events: { name: string; attributes: Record<string, string> }[];
}

export interface TraceSummaryResult {
  durationNs: bigint;
  spanCount: number;
  phases: { name: string; count: number; totalDurationNs: bigint }[];
  subgraphs: {
    subgraphName: string;
    fetches: number;
    totalDurationNs: bigint;
    maxDurationNs: bigint;
    criticalPathNs: bigint;
    errors: number;
  }[];
  errors: { spanId: string; spanName: string; subgraphName: string; kind: string; message: string; code: string }[];
  criticalPath: { spanId: string; spanName: string; subgraphName: string; selfDurationNs: bigint }[];
  eventsAvailable: boolean;
}

const PHASE_SPANS = [
  'HTTP - Read Body',
  'HTTP - Read Multipart',
  'Authenticate',
  'Load Persisted Operation',
  'Operation - Parse',
  'Operation - Normalize',
  'Operation - Validate',
  'Operation - Plan',
  'Operation - Execute',
];
const FETCH_SPAN = 'Engine - Fetch';
const SUBGRAPH_ATTRIBUTE = 'wg.subgraph.name';

interface Node {
  span: SummarySpan;
  end: bigint;
  children: Node[];
  /** The subgraph of this span or of the fetch it runs under. */
  subgraph: string;
}

export function summarizeTrace(spans: SummarySpan[], eventsAvailable: boolean): TraceSummaryResult {
  const nodes = new Map<string, Node>(
    spans.map((span) => [span.spanId, { span, end: span.start + span.durationNs, children: [], subgraph: '' }]),
  );
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.span.parentSpanId);
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const assignSubgraph = (node: Node, inherited: string) => {
    node.subgraph = node.span.attributes[SUBGRAPH_ATTRIBUTE] || inherited;
    for (const child of node.children) {
      assignSubgraph(child, node.subgraph);
    }
  };
  for (const root of roots) {
    assignSubgraph(root, '');
  }

  let start = spans[0]?.start ?? 0n;
  let end = 0n;
  for (const node of nodes.values()) {
    if (node.span.start < start) {
      start = node.span.start;
    }
    if (node.end > end) {
      end = node.end;
    }
  }

  // Phases.
  const phases = new Map<string, { count: number; totalDurationNs: bigint }>();
  for (const span of spans) {
    if (PHASE_SPANS.includes(span.spanName)) {
      const phase = phases.get(span.spanName) ?? { count: 0, totalDurationNs: 0n };
      phase.count += 1;
      phase.totalDurationNs += span.durationNs;
      phases.set(span.spanName, phase);
    }
  }

  // Critical path: from the span that ends last, walk back through the child that ends last before each point.
  const criticalPath: TraceSummaryResult['criticalPath'] = [];
  const walk = (node: Node, bound: bigint) => {
    let cursor = node.end < bound ? node.end : bound;
    let self = 0n;
    const children = [...node.children].sort((a, b) => (b.end > a.end ? 1 : b.end < a.end ? -1 : 0));
    const visited: (() => void)[] = [];
    for (const child of children) {
      if (child.span.start >= cursor) {
        continue;
      }
      const childEnd = child.end < cursor ? child.end : cursor;
      self += cursor - childEnd;
      const childBound = childEnd;
      visited.push(() => walk(child, childBound));
      cursor = child.span.start > node.span.start ? child.span.start : node.span.start;
    }
    self += cursor > node.span.start ? cursor - node.span.start : 0n;
    criticalPath.push({
      spanId: node.span.spanId,
      spanName: node.span.spanName,
      subgraphName: node.subgraph,
      selfDurationNs: self,
    });
    for (const visit of visited) {
      visit();
    }
  };
  const lastRoot = [...roots].sort((a, b) => (b.end > a.end ? 1 : b.end < a.end ? -1 : 0))[0];
  if (lastRoot) {
    walk(lastRoot, lastRoot.end);
  }

  // Subgraphs.
  const subgraphs = new Map<string, TraceSummaryResult['subgraphs'][number]>();
  const subgraphEntry = (name: string) => {
    let entry = subgraphs.get(name);
    if (!entry) {
      entry = {
        subgraphName: name,
        fetches: 0,
        totalDurationNs: 0n,
        maxDurationNs: 0n,
        criticalPathNs: 0n,
        errors: 0,
      };
      subgraphs.set(name, entry);
    }
    return entry;
  };
  for (const node of nodes.values()) {
    if (node.span.spanName === FETCH_SPAN && node.subgraph) {
      const entry = subgraphEntry(node.subgraph);
      entry.fetches += 1;
      entry.totalDurationNs += node.span.durationNs;
      if (node.span.durationNs > entry.maxDurationNs) {
        entry.maxDurationNs = node.span.durationNs;
      }
      if (node.span.statusCode === 'STATUS_CODE_ERROR') {
        entry.errors += 1;
      }
    }
  }
  for (const segment of criticalPath) {
    if (segment.subgraphName && subgraphs.has(segment.subgraphName)) {
      subgraphEntry(segment.subgraphName).criticalPathNs += segment.selfDurationNs;
    }
  }

  // Errors.
  const errors: TraceSummaryResult['errors'] = [];
  for (const node of nodes.values()) {
    const { span, subgraph } = node;
    if (span.statusCode === 'STATUS_CODE_ERROR') {
      errors.push({
        spanId: span.spanId,
        spanName: span.spanName,
        subgraphName: subgraph,
        kind: 'status',
        message: span.statusMessage,
        code: span.attributes['http.status_code'] ?? '',
      });
    }
    for (const event of span.events) {
      if (event.name === 'exception') {
        errors.push({
          spanId: span.spanId,
          spanName: span.spanName,
          subgraphName: subgraph,
          kind: 'exception',
          message: event.attributes['exception.message'] ?? '',
          code: event.attributes['exception.type'] ?? '',
        });
      } else if (event.name.startsWith('Downstream error')) {
        errors.push({
          spanId: span.spanId,
          spanName: span.spanName,
          subgraphName: subgraph,
          kind: 'downstream',
          message: event.attributes['wg.subgraph.error.message'] ?? '',
          code: event.attributes['wg.subgraph.error.extended_code'] ?? '',
        });
      }
    }
  }

  return {
    durationNs: end > start ? end - start : 0n,
    spanCount: spans.length,
    phases: PHASE_SPANS.filter((name) => phases.has(name)).map((name) => ({ name, ...phases.get(name)! })),
    subgraphs: [...subgraphs.values()].sort((a, b) =>
      b.totalDurationNs > a.totalDurationNs ? 1 : b.totalDurationNs < a.totalDurationNs ? -1 : 0,
    ),
    errors,
    criticalPath,
    eventsAvailable,
  };
}
