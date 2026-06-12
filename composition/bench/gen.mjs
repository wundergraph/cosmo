#!/usr/bin/env node
// Deterministic generator for a heavy BUT VALID federation composition benchmark.
//
// Emits one `.graphql` SDL file per subgraph plus a `manifest.json` under
// ./scenario. The output is language-neutral: any port (TS/Go/Rust) can read
// the SDL files and the manifest and feed them to its own federate API.
//
// There is NO randomness. Everything is derived from integer indices so the
// scenario is byte-for-byte reproducible. Tune the SCALE knobs below to make
// composition slower/faster.
//
// Usage: node gen.mjs
//
// ---------------------------------------------------------------------------
// Correctness model (so composition SUCCEEDS with 0 errors)
// ---------------------------------------------------------------------------
// We deliberately use ONLY conservative, well-supported federation features
// so that TS, Go, and Rust ports all compose this IDENTICALLY:
//
//   * Shared ENTITIES: every entity has a consistent `@key(fields: "id")` in
//     EVERY subgraph that references it. Field OWNERSHIP is partitioned so no
//     two subgraphs declare the same non-key field unless it is @shareable.
//       - Each entity has exactly ONE "owner" subgraph (round-robin) that
//         declares its large set of "base" fields.
//       - A different subgraph (the "extender") declares the key plus its OWN
//         disjoint set of fields. No overlap -> no merge conflicts.
//       - Entities reference OTHER entities (entityRef) to force the
//         resolvability-graph walk to traverse the whole entity graph.
//   * @shareable VALUE TYPES: declared byte-for-byte identically in EVERY
//     subgraph. Identical shareable declarations merge cleanly.
//   * @external / @requires / @provides used in the canonical valid shape:
//       - The extender subgraph declares @external copies of a FEW owner base
//         fields, then a @requires computed field referencing them.
//       - @provides is emitted on a Query root field that returns the entity,
//         providing fields that the resolving subgraph itself marks @external
//         (the textbook valid @provides shape).
//   * Interfaces implemented by many objects, unions, enums, input objects,
//     and a deep nested value-type chain (for type-kind breadth + nesting).
//
// Nothing exotic: no @interfaceObject, no @override, no @inaccessible, no
// contracts, no event-driven, no subscription filters.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'scenario');

// ---------------------------------------------------------------------------
// SCALE knobs. Increase these to make federateSubgraphs take longer.
// ---------------------------------------------------------------------------
const SUBGRAPHS = Number(process.env.BENCH_SUBGRAPHS ?? 150);
// Shared entities, referenced (consistently) across subgraphs.
const SHARED_ENTITIES = Number(process.env.BENCH_SHARED_ENTITIES ?? 150);
// Base fields the OWNER subgraph declares on each entity.
const OWNER_FIELDS = Number(process.env.BENCH_OWNER_FIELDS ?? 28);
// Extra fields the EXTENDER subgraph declares on each entity (disjoint set).
const EXTENDER_FIELDS = Number(process.env.BENCH_EXTENDER_FIELDS ?? 10);
// How many @external owner fields the extender pulls in for @requires.
const REQUIRES_FIELDS = Number(process.env.BENCH_REQUIRES_FIELDS ?? 3);
// Depth of the per-subgraph nested value-type chain.
const CHAIN_DEPTH = Number(process.env.BENCH_CHAIN_DEPTH ?? 16);
// Width (fields) of each nested object in the chain.
const CHAIN_WIDTH = Number(process.env.BENCH_CHAIN_WIDTH ?? 8);
// Objects implementing each interface, per subgraph.
const IFACE_IMPLEMENTERS = Number(process.env.BENCH_IFACE_IMPLEMENTERS ?? 8);
// Interface field count.
const IFACE_FIELDS = Number(process.env.BENCH_IFACE_FIELDS ?? 8);
// Members in each union, per subgraph.
const UNION_MEMBERS = Number(process.env.BENCH_UNION_MEMBERS ?? 8);
// Fields on the wide shared (@shareable) value type.
const VALUE_FIELDS = Number(process.env.BENCH_VALUE_FIELDS ?? 18);

// ---------------------------------------------------------------------------
// Helpers (pure, index-driven).
// ---------------------------------------------------------------------------
const scalars = ['String', 'Int', 'Float', 'Boolean', 'ID'];
const scalarFor = (i) => scalars[i % scalars.length];

// The OWNER of entity `e` is the subgraph that declares its base fields.
const ownerOf = (e) => e % SUBGRAPHS;
// The EXTENDER of entity `e` declares the key + its disjoint field set and the
// @requires computed field. Picked deterministically and != owner.
const extenderOf = (e) => (e + 1) % SUBGRAPHS;

// Build the SDL for subgraph `s` (0-based).
function buildSubgraph(s) {
  const lines = [];

  // Query root fields are collected and emitted last so @provides field sets
  // can reference @external fields declared on this subgraph's entity copies.
  const queryFields = [`  sg${s}_health: String!`];

  // -------------------------------------------------------------------------
  // Shared entities.
  // -------------------------------------------------------------------------
  // For each entity, this subgraph plays one of three roles:
  //   owner    -> declare key + OWNER_FIELDS base fields (+ entity cross-refs)
  //   extender -> declare key + EXTENDER_FIELDS disjoint fields,
  //               + @external copies of REQUIRES_FIELDS owner fields,
  //               + a @requires computed field over them
  //   neither  -> do NOT declare the entity at all (keeps merges clean)
  //
  // We track, per entity, which fields THIS subgraph declared @external so we
  // can emit a valid @provides on a Query root field returning that entity.
  const providableByEntity = new Map(); // e -> [external field names declared here]
  // Entities this subgraph DECLARES (owner or extender). Any entity REFERENCED
  // by this subgraph (cross-ref / chain entityRef / iface selfRef) that is not
  // declared here must get a key-only stub so the type is defined locally.
  const declaredEntities = new Set();
  const referencedEntities = new Set();

  for (let e = 0; e < SHARED_ENTITIES; e++) {
    const owner = ownerOf(e);
    const extender = extenderOf(e);

    if (s === owner) {
      declaredEntities.add(e);
      const fields = [`  id: ID!`];
      for (let f = 0; f < OWNER_FIELDS; f++) {
        fields.push(`  e${e}_o${f}: ${scalarFor(e + f)}!`);
      }
      // Cross-reference two other entities to grow the resolvability graph.
      const ref1 = (e + 7) % SHARED_ENTITIES;
      const ref2 = (e + 13) % SHARED_ENTITIES;
      fields.push(`  e${e}_refA: Entity${ref1}`);
      fields.push(`  e${e}_refB: Entity${ref2}`);
      referencedEntities.add(ref1);
      referencedEntities.add(ref2);
      lines.push(`type Entity${e} @key(fields: "id") {\n${fields.join('\n')}\n}`);
    } else if (s === extender) {
      declaredEntities.add(e);
      const fields = [`  id: ID!`];
      // Disjoint field namespace (x*) so it never collides with owner (o*).
      for (let f = 0; f < EXTENDER_FIELDS; f++) {
        fields.push(`  e${e}_x${f}: ${scalarFor(e + f + 1)}`);
      }
      // @external copies of a few owner base fields, then a @requires over them.
      const ext = [];
      const reqCount = Math.min(REQUIRES_FIELDS, OWNER_FIELDS);
      for (let r = 0; r < reqCount; r++) {
        const of = (e + r) % OWNER_FIELDS;
        const fname = `e${e}_o${of}`;
        if (!ext.includes(fname)) {
          fields.push(`  ${fname}: ${scalarFor(e + of)}! @external`);
          ext.push(fname);
        }
      }
      if (ext.length > 0) {
        fields.push(
          `  e${e}_computed: String! @requires(fields: "${ext.join(' ')}")`,
        );
        providableByEntity.set(e, ext);
      }
      lines.push(`type Entity${e} @key(fields: "id") {\n${fields.join('\n')}\n}`);
    }
  }

  // -------------------------------------------------------------------------
  // Query root fields referencing entities owned/extended here.
  // -------------------------------------------------------------------------
  for (let e = 0; e < SHARED_ENTITIES; e++) {
    if (s === ownerOf(e) || s === extenderOf(e)) {
      queryFields.push(`  sg${s}_entity${e}(id: ID!): Entity${e}`);
    }
    // Valid @provides: only on a subgraph that declared those fields @external.
    const ext = providableByEntity.get(e);
    if (ext && ext.length > 0) {
      queryFields.push(
        `  sg${s}_provided${e}: Entity${e} @provides(fields: "${ext.join(' ')}")`,
      );
    }
  }
  queryFields.push(`  sg${s}_node: Node${s}`);
  queryFields.push(`  sg${s}_payload: Payload${s}`);
  queryFields.push(`  sg${s}_chainHead: Chain${s}_0`);

  // -------------------------------------------------------------------------
  // Deep nested value-type chain (subgraph-local; names are namespaced by s).
  // Chain{s}_0 -> _1 -> ... -> _N, each referencing a shared entity.
  // -------------------------------------------------------------------------
  for (let d = 0; d < CHAIN_DEPTH; d++) {
    const cf = [];
    for (let w = 0; w < CHAIN_WIDTH; w++) {
      cf.push(`  c${d}_f${w}: ${scalarFor(d + w)}!`);
    }
    if (d + 1 < CHAIN_DEPTH) {
      cf.push(`  next: Chain${s}_${d + 1}`);
    }
    const chainRef = (d * 3) % SHARED_ENTITIES;
    cf.push(`  entityRef: Entity${chainRef}`);
    referencedEntities.add(chainRef);
    lines.push(`type Chain${s}_${d} {\n${cf.join('\n')}\n}`);
  }

  // -------------------------------------------------------------------------
  // Interface implemented by many objects (subgraph-local names).
  // -------------------------------------------------------------------------
  const ifaceFields = [];
  for (let f = 0; f < IFACE_FIELDS; f++) {
    ifaceFields.push(`  if_f${f}: ${scalarFor(f)}!`);
  }
  lines.push(`interface Node${s} {\n${ifaceFields.join('\n')}\n}`);
  for (let i = 0; i < IFACE_IMPLEMENTERS; i++) {
    const objName = `Node${s}Impl${i}`;
    const objFields = ifaceFields.slice();
    for (let f = 0; f < 5; f++) {
      objFields.push(`  extra${i}_f${f}: ${scalarFor(i + f)}`);
    }
    const selfRef = (s + i) % SHARED_ENTITIES;
    objFields.push(`  selfRef: Entity${selfRef}`);
    referencedEntities.add(selfRef);
    lines.push(`type ${objName} implements Node${s} {\n${objFields.join('\n')}\n}`);
  }

  // -------------------------------------------------------------------------
  // Key-only stubs for entities REFERENCED but not declared in this subgraph.
  // `type EntityN @key(fields: "id") { id: ID! }` is the canonical federation
  // entity-reference pattern and merges cleanly with the owner declaration.
  // This also enlarges the resolvability graph (every stub is an entity node
  // the resolvability walk must reconcile across subgraphs).
  // -------------------------------------------------------------------------
  for (const e of referencedEntities) {
    if (!declaredEntities.has(e)) {
      lines.push(`type Entity${e} @key(fields: "id") {\n  id: ID!\n}`);
    }
  }

  // -------------------------------------------------------------------------
  // Union over dedicated payload types (subgraph-local names).
  // -------------------------------------------------------------------------
  const unionMembers = [];
  for (let m = 0; m < UNION_MEMBERS; m++) {
    const pName = `Payload${s}_${m}`;
    unionMembers.push(pName);
    const pf = [];
    for (let f = 0; f < 6; f++) {
      pf.push(`  p${m}_f${f}: ${scalarFor(m + f)}!`);
    }
    lines.push(`type ${pName} {\n${pf.join('\n')}\n}`);
  }
  lines.push(`union Payload${s} = ${unionMembers.join(' | ')}`);

  // -------------------------------------------------------------------------
  // Wide shared value type (@shareable), declared IDENTICALLY in every
  // subgraph so it merges cleanly. Reachable from the root.
  // -------------------------------------------------------------------------
  {
    const vf = [];
    for (let f = 0; f < VALUE_FIELDS; f++) {
      vf.push(`  v_f${f}: ${scalarFor(f)}! @shareable`);
    }
    lines.push(`type WideValue @shareable {\n${vf.join('\n')}\n}`);
  }

  // -------------------------------------------------------------------------
  // Shared enum + input object (identical in every subgraph).
  // -------------------------------------------------------------------------
  {
    const ev = [];
    for (let f = 0; f < 8; f++) ev.push(`  E${f}`);
    lines.push(`enum SharedEnum {\n${ev.join('\n')}\n}`);
    const inf = [];
    for (let f = 0; f < 10; f++) inf.push(`  in_f${f}: ${scalarFor(f)}`);
    lines.push(`input SharedInput {\n${inf.join('\n')}\n}`);
  }

  queryFields.push(`  sg${s}_wide(input: SharedInput): WideValue @shareable`);
  queryFields.push(`  sg${s}_enum: SharedEnum @shareable`);

  // Emit the Query root first.
  lines.unshift(`type Query {\n${queryFields.join('\n')}\n}`);

  return lines.join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------
// Emit.
// ---------------------------------------------------------------------------
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const manifest = { subgraphs: [] };
let totalBytes = 0;
for (let s = 0; s < SUBGRAPHS; s++) {
  const name = `subgraph-${s}`;
  const file = `${name}.graphql`;
  const sdl = buildSubgraph(s);
  writeFileSync(join(OUT_DIR, file), sdl);
  totalBytes += Buffer.byteLength(sdl);
  manifest.subgraphs.push({
    name,
    url: `http://localhost:4000/${name}/graphql`,
    file,
  });
}
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(
  `Generated ${manifest.subgraphs.length} subgraphs (${(totalBytes / 1024).toFixed(0)} KiB SDL) into ${OUT_DIR}\n` +
    `Knobs: SUBGRAPHS=${SUBGRAPHS} SHARED_ENTITIES=${SHARED_ENTITIES} OWNER_FIELDS=${OWNER_FIELDS} ` +
    `EXTENDER_FIELDS=${EXTENDER_FIELDS} REQUIRES_FIELDS=${REQUIRES_FIELDS} ` +
    `CHAIN_DEPTH=${CHAIN_DEPTH} CHAIN_WIDTH=${CHAIN_WIDTH} IFACE_IMPLEMENTERS=${IFACE_IMPLEMENTERS} ` +
    `UNION_MEMBERS=${UNION_MEMBERS} VALUE_FIELDS=${VALUE_FIELDS}`,
);
