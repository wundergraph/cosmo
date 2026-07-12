// Inline defer advisor annotations for the query editor (CodeMirror 5):
// VSCode-style inlay pills after each field. Color carries exactly one meaning
// — latency severity, i.e. how much a first response would gain from deferring
// the field: green = fine, amber = ok-ish, red = the bottleneck. The slow rows
// get a matching left-rail so "where the latency comes from" is visible at rest,
// without hover. Deferring is always the good move, so the action button is a
// single green call-to-action that spells out the payoff ("Defer · 450ms
// faster"); clicking it turns the red field green.

import { DocumentNode, FieldNode, FragmentDefinitionNode, Kind, SelectionSetNode, parse } from 'graphql';
import { DeferAdvisorResult } from './defer-advisor-types';
import { selectOperation } from './defer-advisor-rewrite';

type FragmentMap = Map<string, FragmentDefinitionNode>;

type CodeMirrorEditor = any;

export type InlineDeferGroup = { path: string; fields: string[]; label: string };

export type InlineDeferCallbacks = {
  onDefer: (parentPath: string, field: string, label: string) => void;
  onUndefer: (parentPath: string, field: string) => void;
  onApplyAll: (groups: InlineDeferGroup[]) => void;
};

let activeMarks: { clear: () => void }[] = [];

export const clearInlineAnnotations = () => {
  for (const mark of activeMarks) {
    mark.clear();
  }
  activeMarks = [];
};

// showInlineNotice replaces the annotations with a single status chip above
// the operation — feedback while measuring, or when there is nothing to
// measure yet.
export const showInlineNotice = (cm: CodeMirrorEditor, text: string, busy: boolean) => {
  clearInlineAnnotations();
  const node = document.createElement('div');
  node.style.cssText = 'padding:2px 0 6px 4px;';
  const chip = document.createElement('span');
  chip.style.cssText =
    'display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:9px;' +
    'font-size:10.5px;line-height:15px;font-family:ui-sans-serif,system-ui,sans-serif;' +
    'background:rgba(125,125,125,0.12);color:#8b93a3;user-select:none;';
  if (busy) {
    chip.className = 'animate-pulse';
  }
  chip.textContent = text;
  node.appendChild(chip);
  const widget = cm.addLineWidget(cm.firstLine(), node, { above: true, noHScroll: true });
  activeMarks.push({ clear: () => widget.clear() });
};

// One scale, one meaning: how much a first response would gain from deferring.
type Severity = 'ok' | 'med' | 'high';
const OK = '#34d399'; // green — fine as it is, or already deferred
const MED = '#f59e0b'; // amber — ok-ish, deferring is optional
const HIGH = '#f43f5e'; // red — the bottleneck, defer this
const severityColor: Record<Severity, string> = { ok: OK, med: MED, high: HIGH };
const MUTED = '#8b93a3';

// Slow rows carry a left-rail + faint wash in their severity color so the
// bottleneck is legible at rest. Deferred rows go quiet green ("handled").
const railStyleId = 'defer-inline-rows';
const ensureRailStyles = () => {
  if (document.getElementById(railStyleId)) {
    return;
  }
  const style = document.createElement('style');
  style.id = railStyleId;
  style.textContent =
    `.cm-defer-row-high { background: rgba(244,63,94,0.07); box-shadow: inset 3px 0 0 ${HIGH}; }\n` +
    `.cm-defer-row-med  { background: rgba(245,158,11,0.07); box-shadow: inset 3px 0 0 ${MED}; }\n` +
    `.cm-defer-row-done { background: rgba(52,211,153,0.05); box-shadow: inset 3px 0 0 ${OK}; }`;
  document.head.appendChild(style);
};

// deferSuggestionLabel mirrors the router's label scheme (defer_advisor.go) so an
// inline-applied defer and the router's suggestion for the same field agree —
// unique per (subgraph, path, field) to avoid collisions across paths.
const deferSuggestionLabel = (subgraph: string, path: string, field: string): string =>
  path ? `${subgraph}:${path}:${field}` : `${subgraph}:${field}`;

const responseName = (field: FieldNode) => field.alias?.value ?? field.name.value;

const hasDeferDirective = (directives?: readonly { name: { value: string } }[]) =>
  !!directives?.some((d) => d.name.value === 'defer');

type FieldHit = {
  node: FieldNode;
  deferred: boolean;
};

// findFieldByPath resolves a response-name path to its field node, descending
// transparently through inline fragments and fragment spreads (into the
// fragment definitions, where the field's source position lives) and
// remembering whether the field sits inside a @defer fragment.
const findFieldByPath = (
  set: SelectionSetNode,
  path: string[],
  inDefer: boolean,
  fragments: FragmentMap,
  visited = new Set<string>(),
): FieldHit | undefined => {
  const [head, ...rest] = path;
  for (const sel of set.selections) {
    if (sel.kind === Kind.FIELD && responseName(sel) === head) {
      if (rest.length === 0) {
        return { node: sel, deferred: inDefer };
      }
      return sel.selectionSet ? findFieldByPath(sel.selectionSet, rest, inDefer, fragments, visited) : undefined;
    }
    if (sel.kind === Kind.INLINE_FRAGMENT) {
      const found = findFieldByPath(
        sel.selectionSet,
        path,
        inDefer || hasDeferDirective(sel.directives),
        fragments,
        visited,
      );
      if (found) {
        return found;
      }
    }
    if (sel.kind === Kind.FRAGMENT_SPREAD && !visited.has(sel.name.value)) {
      visited.add(sel.name.value);
      const fragment = fragments.get(sel.name.value);
      if (fragment) {
        const found = findFieldByPath(
          fragment.selectionSet,
          path,
          inDefer || hasDeferDirective(sel.directives),
          fragments,
          visited,
        );
        if (found) {
          return found;
        }
      }
    }
  }
  return undefined;
};

// collectOwnedRanges gathers the source ranges a field claims: its own subtree
// plus the definitions of every fragment spread inside it, so fragment blocks
// are railed like the inlined selection they stand for.
const collectOwnedRanges = (
  node: FieldNode | FragmentDefinitionNode,
  fragments: FragmentMap,
  ranges: { start: number; end: number }[],
  visited = new Set<string>(),
) => {
  if (node.loc) {
    ranges.push({ start: node.loc.start, end: node.loc.end });
  }
  const walkSet = (set: SelectionSetNode | undefined) => {
    if (!set) {
      return;
    }
    for (const sel of set.selections) {
      if (sel.kind === Kind.FIELD) {
        walkSet(sel.selectionSet);
      } else if (sel.kind === Kind.INLINE_FRAGMENT) {
        walkSet(sel.selectionSet);
      } else if (sel.kind === Kind.FRAGMENT_SPREAD && !visited.has(sel.name.value)) {
        visited.add(sel.name.value);
        const fragment = fragments.get(sel.name.value);
        if (fragment) {
          collectOwnedRanges(fragment, fragments, ranges, visited);
        }
      }
    }
  };
  walkSet(node.selectionSet);
};

const formatInlineMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);

type PillOptions = {
  subgraph: string;
  latencyMs: number;
  severity: Severity;
  deferred: boolean;
  // suppressed: measured but not worth deferring (fast) — no action button.
  initial: boolean;
  savingMs?: number;
  onDefer?: () => void;
  onUndefer?: () => void;
};

// buildPillAction renders a real, obviously-clickable button: a filled green
// call-to-action ("do the good thing") or a quiet outlined secondary control.
const buildPillAction = (text: string, title: string, onClick: () => void, variant: 'solid' | 'ghost'): HTMLElement => {
  const action = document.createElement('button');
  action.textContent = text;
  action.title = title;
  const base =
    'all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:4px;' +
    'padding:2px 9px;border-radius:7px;font-weight:600;font-size:10px;line-height:14px;' +
    'white-space:nowrap;transition:filter 0.1s,transform 0.1s;';
  if (variant === 'solid') {
    action.style.cssText = base + `background:${OK};color:#08130d;box-shadow:0 1px 2px rgba(0,0,0,0.3);`;
  } else {
    action.style.cssText =
      base + `background:transparent;color:${MUTED};box-shadow:inset 0 0 0 1px rgba(148,163,184,0.45);`;
  }
  action.onmouseenter = () => {
    action.style.filter = 'brightness(1.08)';
    action.style.transform = 'translateY(-1px)';
  };
  action.onmouseleave = () => {
    action.style.filter = 'none';
    action.style.transform = 'none';
  };
  action.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  };
  return action;
};

const buildPill = (opts: PillOptions): HTMLElement => {
  const color = severityColor[opts.severity];
  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:8px;vertical-align:middle;';

  // Neutral info badge: severity dot + subgraph (grey) + latency (severity color).
  const badge = document.createElement('span');
  badge.style.cssText =
    'display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:9px;' +
    'font-size:10px;line-height:15px;font-family:ui-sans-serif,system-ui,sans-serif;' +
    'background:rgba(125,125,125,0.12);color:#8b93a3;white-space:nowrap;';
  badge.title = `served by the ${opts.subgraph} subgraph`;

  const dot = document.createElement('span');
  dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${opts.deferred ? OK : color};flex-shrink:0;`;
  badge.appendChild(dot);

  const name = document.createElement('span');
  name.textContent = opts.subgraph;
  badge.appendChild(name);

  const latency = document.createElement('span');
  latency.textContent = formatInlineMs(opts.latencyMs);
  latency.style.cssText = `font-variant-numeric:tabular-nums;font-weight:600;color:${opts.deferred ? MUTED : color};`;
  badge.appendChild(latency);

  if (opts.deferred) {
    const state = document.createElement('span');
    state.textContent = '· deferred';
    state.style.cssText = `color:${OK};font-weight:600;`;
    badge.appendChild(state);
  } else if (opts.initial) {
    const state = document.createElement('span');
    state.textContent = '· initial';
    badge.appendChild(state);
  }
  wrap.appendChild(badge);

  if (opts.deferred && opts.onUndefer) {
    wrap.appendChild(
      buildPillAction('Undo', 'Move this field back into the initial response', opts.onUndefer, 'ghost'),
    );
  } else if (opts.onDefer) {
    const label = opts.savingMs && opts.savingMs > 0 ? `Defer · ${formatInlineMs(opts.savingMs)} faster` : 'Defer';
    wrap.appendChild(
      buildPillAction(
        label,
        'Wrap this field in a @defer fragment so the first response arrives sooner',
        opts.onDefer,
        'solid',
      ),
    );
  }

  return wrap;
};

// buildSummaryLens renders the code-lens bar above the operation: how many
// defer opportunities are open, what applying them buys, and a one-click
// apply-all. Once everything is applied it flips to a quiet green confirmation.
const buildSummaryLens = (
  openCount: number,
  appliedAny: boolean,
  jointSavingMs: number,
  onApplyAll: () => void,
): HTMLElement | null => {
  if (openCount === 0 && !appliedAny) {
    return null;
  }
  const lens = document.createElement('div');
  lens.style.cssText = 'padding:2px 0 6px 4px;';
  const chip = document.createElement('span');
  chip.style.cssText =
    'display:inline-flex;align-items:center;gap:8px;padding:2px 9px;border-radius:9px;' +
    'font-size:10.5px;line-height:15px;font-family:ui-sans-serif,system-ui,sans-serif;user-select:none;';
  lens.appendChild(chip);

  if (openCount === 0) {
    chip.style.background = 'rgba(52,211,153,0.12)';
    chip.style.color = OK;
    chip.textContent = '✓ all defer opportunities applied';
    return lens;
  }

  chip.style.background = 'rgba(245,158,11,0.14)';
  chip.style.color = MED;

  const summary = document.createElement('span');
  summary.style.fontWeight = '600';
  const noun = openCount === 1 ? 'slow field blocks' : 'slow fields block';
  summary.textContent = `${openCount} ${noun} the first response`;
  chip.appendChild(summary);

  if (jointSavingMs > 0) {
    const payoff = document.createElement('span');
    payoff.style.cssText = 'opacity:0.85;';
    payoff.textContent = `defer them → respond ${formatInlineMs(jointSavingMs)} sooner`;
    chip.appendChild(payoff);
  }

  chip.appendChild(buildPillAction('Apply all', 'Defer every suggested field', onApplyAll, 'solid'));

  return lens;
};

// renderInlineAnnotations projects the advisor result onto the current editor
// text. Field positions are resolved from the live AST, so annotations from a
// cached measurement stay attached after the query is rewritten with @defer.
export const renderInlineAnnotations = (
  cm: CodeMirrorEditor,
  queryText: string,
  result: DeferAdvisorResult,
  callbacks: InlineDeferCallbacks,
  operationName?: string,
) => {
  clearInlineAnnotations();

  let doc: DocumentNode;
  try {
    doc = parse(queryText);
  } catch {
    return;
  }
  const operation = selectOperation(doc, operationName);
  if (!operation) {
    return;
  }

  ensureRailStyles();

  const fragments: FragmentMap = new Map();
  for (const def of doc.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(def.name.value, def);
    }
  }

  // Suggestions are only published after the complete portfolio is measured.
  // Do not turn that joint result into unsupported per-field saving claims.
  const suggestedPaths = new Set<string>();
  for (const suggestion of result.suggestions) {
    for (const field of suggestion.fields) {
      suggestedPaths.add(suggestion.path ? `${suggestion.path}.${field}` : field);
    }
  }

  type Annotation = {
    path: string;
    subgraph: string;
    latencyMs: number;
    deferrable: boolean;
    hit: FieldHit;
    ownedRanges: { start: number; end: number }[];
  };
  const annotations: Annotation[] = [];

  const resolve = (path: string, subgraph: string, latencyMs: number, deferrable: boolean) => {
    const segments = path.split('.');
    const hit = findFieldByPath(operation.selectionSet, segments, false, fragments);
    if (!hit?.node.name.loc || !hit.node.loc) {
      return;
    }
    const ownedRanges: { start: number; end: number }[] = [];
    collectOwnedRanges(hit.node, fragments, ownedRanges);
    annotations.push({ path, subgraph, latencyMs, deferrable, hit, ownedRanges });
  };

  // Root fetches first: the initial-response skeleton claims its whole subtree,
  // then the dependent fetches' fields overwrite their own lines.
  for (const fetch of result.fetches) {
    if (fetch.dependsOn?.length) {
      continue;
    }
    for (const field of fetch.fields) {
      resolve(field, fetch.subgraph, fetch.durationMs.avgMs, false);
    }
  }
  for (const field of [...result.fields].sort((a, b) => a.path.split('.').length - b.path.split('.').length)) {
    resolve(field.path, field.subgraph, field.latencyMs.avgMs, true);
  }

  // The router decides which fields are worth acting on using floor-invariant
  // measurements. Raw latency only grades those already validated suggestions;
  // it is never presented as an individual TTFB saving.
  const FLOW_MS = 400;
  const severityOf = (a: Annotation): Severity => {
    if (a.hit.deferred || !a.deferrable) {
      return 'ok';
    }
    if (!suggestedPaths.has(a.path)) {
      return 'ok';
    }
    return a.latencyMs >= FLOW_MS ? 'high' : 'med';
  };

  // Only the rows worth acting on get a rail: slow open fields in their severity
  // color, deferred fields in quiet green. Higher severity wins on overlap.
  const rowRank: Record<'done' | 'med' | 'high', number> = { done: 1, med: 2, high: 3 };
  const lineSev = new Map<number, 'done' | 'med' | 'high'>();
  const paint = (ranges: { start: number; end: number }[], sev: 'done' | 'med' | 'high') => {
    for (const range of ranges) {
      const fromLine = cm.posFromIndex(range.start).line;
      const toLine = cm.posFromIndex(range.end).line;
      for (let line = fromLine; line <= toLine; line++) {
        const cur = lineSev.get(line);
        if (!cur || rowRank[sev] > rowRank[cur]) {
          lineSev.set(line, sev);
        }
      }
    }
  };

  for (const annotation of annotations) {
    const segments = annotation.path.split('.');
    const field = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join('.');
    const { hit } = annotation;
    const severity = severityOf(annotation);

    if (hit.deferred) {
      paint(annotation.ownedRanges, 'done');
    } else if (severity === 'high' || severity === 'med') {
      paint(annotation.ownedRanges, severity);
    }

    const pill = buildPill({
      subgraph: annotation.subgraph,
      latencyMs: annotation.latencyMs,
      severity,
      deferred: hit.deferred,
      initial: !annotation.deferrable,
      // Only offer the action where it pays off: a Defer CTA on a fast field
      // reads as advice to defer something that gains nothing.
      onDefer:
        annotation.deferrable && !hit.deferred && severity !== 'ok'
          ? () => callbacks.onDefer(parentPath, field, deferSuggestionLabel(annotation.subgraph, parentPath, field))
          : undefined,
      onUndefer: annotation.deferrable && hit.deferred ? () => callbacks.onUndefer(parentPath, field) : undefined,
    });
    activeMarks.push(cm.setBookmark(cm.posFromIndex(hit.node.name.loc!.end), { widget: pill, insertLeft: false }));
  }

  lineSev.forEach((sev, line) => {
    const cls = `cm-defer-row-${sev}`;
    const handle = cm.addLineClass(line, 'background', cls);
    activeMarks.push({ clear: () => cm.removeLineClass(handle, 'background', cls) });
  });

  // Summary lens above the operation.
  const deferredPaths = new Set<string>();
  for (const annotation of annotations) {
    if (annotation.hit.deferred) {
      deferredPaths.add(annotation.path);
    }
  }
  const openGroups = result.suggestions
    .map((suggestion) => ({
      path: suggestion.path ?? '',
      fields: suggestion.fields.filter(
        (field) => !deferredPaths.has(suggestion.path ? `${suggestion.path}.${field}` : field),
      ),
      label: suggestion.label,
    }))
    .filter((group) => group.fields.length > 0);
  const openCount = openGroups.reduce((sum, group) => sum + group.fields.length, 0);
  const appliedAny = result.suggestions.some((suggestion) =>
    suggestion.fields.some((field) => deferredPaths.has(suggestion.path ? `${suggestion.path}.${field}` : field)),
  );
  const jointSavingMs = result.validation?.initialResponseSavingMs.avgMs ?? 0;
  const lens = buildSummaryLens(openCount, appliedAny, jointSavingMs, () => callbacks.onApplyAll(openGroups));
  if (lens) {
    const widget = cm.addLineWidget(cm.firstLine(), lens, { above: true, noHScroll: true });
    activeMarks.push({ clear: () => widget.clear() });
  }
};
