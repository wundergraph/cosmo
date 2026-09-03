/**
 * Prints the retainer tree of heap snapshot nodes, i.e. WHY an object is still alive.
 *
 *   node --max-old-space-size=4096 scripts/memory-load-test/heap-retainers.mjs <snapshot> <class|@nodeId> [depth=8] [branching=3] [sample=3]
 *
 * <class> is "<type>:<name>" as printed by heap-snapshot-diff.mjs, e.g. "object:FederationFactory";
 * "@1234" selects one node by id instead. Weak edges are skipped because they do not keep an object alive.
 */
import { readFileSync } from 'node:fs';

const [, , path, target, depthArg = '8', branchingArg = '3', sampleArg = '3'] = process.argv;
if (!path || !target) {
  console.error('usage: heap-retainers.mjs <snapshot> <type:name | @nodeId> [depth] [branching] [sample]');
  process.exit(1);
}

const snapshot = JSON.parse(readFileSync(path, 'utf8'));
const nodeFields = snapshot.snapshot.meta.node_fields;
const edgeFields = snapshot.snapshot.meta.edge_fields;
const nodeTypes = snapshot.snapshot.meta.node_types[0];
const edgeTypes = snapshot.snapshot.meta.edge_types[0];
const NF = nodeFields.length;
const EF = edgeFields.length;
const { nodes, edges, strings } = snapshot;
const nType = nodeFields.indexOf('type');
const nName = nodeFields.indexOf('name');
const nId = nodeFields.indexOf('id');
const nSize = nodeFields.indexOf('self_size');
const nEdgeCount = nodeFields.indexOf('edge_count');
const eType = edgeFields.indexOf('type');
const eName = edgeFields.indexOf('name_or_index');
const eTo = edgeFields.indexOf('to_node');
const nodeCount = nodes.length / NF;

const firstEdge = new Uint32Array(nodeCount + 1);
for (let i = 0, offset = 0; i < nodeCount; i++) {
  firstEdge[i] = offset;
  offset += nodes[i * NF + nEdgeCount];
  firstEdge[nodeCount] = offset;
}
const retainersByNode = new Map();
const nodeById = new Map();
for (let i = 0; i < nodeCount; i++) {
  nodeById.set(nodes[i * NF + nId], i);
  for (let e = firstEdge[i]; e < firstEdge[i + 1]; e++) {
    if (edgeTypes[edges[e * EF + eType]] === 'weak') {
      continue;
    }
    const to = edges[e * EF + eTo] / NF;
    let retainers = retainersByNode.get(to);
    if (!retainers) {
      retainersByNode.set(to, (retainers = []));
    }
    retainers.push([i, e]);
  }
}

const nodeLabel = (i) => {
  const name = strings[nodes[i * NF + nName]];
  return `${nodeTypes[nodes[i * NF + nType]]}:${name.length > 70 ? name.slice(0, 70) + '…' : name}@${nodes[i * NF + nId]} (${nodes[i * NF + nSize]}B)`;
};
const edgeLabel = (e) => {
  const type = edgeTypes[edges[e * EF + eType]];
  const value = edges[e * EF + eName];
  return type === 'element' || type === 'hidden' ? `${type}[${value}]` : `${type}:${strings[value]}`;
};

function printRetainers(i, depth, indent, seen) {
  if (depth === 0) {
    return;
  }
  const retainers = retainersByNode.get(i) ?? [];
  // prefer real objects over GC roots so the path through user objects is shown first
  retainers.sort(
    (a, b) =>
      (nodeTypes[nodes[a[0] * NF + nType]] === 'synthetic') - (nodeTypes[nodes[b[0] * NF + nType]] === 'synthetic'),
  );
  const shown = retainers.slice(0, Number(branchingArg));
  for (const [from, e] of shown) {
    const alreadySeen = seen.has(from);
    console.log(`${indent}<- ${edgeLabel(e)}  ${nodeLabel(from)}${alreadySeen ? ' (seen)' : ''}`);
    if (alreadySeen || nodeTypes[nodes[from * NF + nType]] === 'synthetic') {
      continue;
    }
    seen.add(from);
    printRetainers(from, depth - 1, indent + '   ', seen);
  }
  if (retainers.length > shown.length) {
    console.log(`${indent}   … ${retainers.length - shown.length} more retainers`);
  }
}

let targets = [];
if (target.startsWith('@')) {
  const i = nodeById.get(Number(target.slice(1)));
  if (i === undefined) {
    throw new Error(`no node with id ${target}`);
  }
  targets = [i];
} else {
  const [wantedType, ...rest] = target.split(':');
  const wantedName = rest.join(':');
  for (let i = 0; i < nodeCount; i++) {
    if (
      nodeTypes[nodes[i * NF + nType]] === wantedType &&
      (!wantedName || strings[nodes[i * NF + nName]] === wantedName)
    ) {
      targets.push(i);
    }
  }
  console.log(
    `${targets.length} node(s) match ${target}; showing the last ${Math.min(targets.length, Number(sampleArg))}`,
  );
  targets = targets.slice(-Number(sampleArg));
}
for (const i of targets) {
  console.log(`\n${nodeLabel(i)}`);
  printRetainers(i, Number(depthArg), '', new Set([i]));
}
