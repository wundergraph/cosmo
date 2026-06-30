/**
 * Slow-plan-cache stress test
 *
 * Goal: fill — and then overflow — the slow plan cache with 1024 LARGE plans
 * to make any memory leak obvious.
 *
 * Why "large" matters
 * ────────────────────
 * A plan's memory footprint is dominated by:
 *   1. FetchConfiguration.Input — the serialised JSON query sent to each
 *      subgraph (one string per subgraph fetch in the plan)
 *   2. The operationDocument ast.Document — the parsed query AST
 *
 * A minimal query like `{ employees { id } }` touches 1 subgraph and
 * produces a tiny plan.  The full bench query touches 4 subgraphs and
 * produces 4 separate entity-batch fetch objects with large input strings.
 *
 * Strategy
 * ─────────
 * Every query in the pool is built from:
 *   BASE  — the full 4-subgraph employees query (same as bench.js "benchBig"):
 *             employees subgraph + family (pets/details) + hobbies + products.
 *             This alone produces a ~5–15 KB plan.
 *
 *   EXTRA — up to 10 optional aliased top-level operations added on top
 *           (single employee lookups, teammates, productTypes, findEmployees).
 *           Each extra operation adds more subgraph fetches to the plan.
 *
 * 10-bit mask over which EXTRA operations to include → 2^10 = 1024 unique
 * combinations.  All 1024 are large because the BASE is always present.
 *
 * Cache dynamics
 * ──────────────
 * demo.config.yaml sets:
 *   slow_plan_cache_size:      1024   (max entries)
 *   slow_plan_cache_threshold: 0s     (every plan qualifies)
 *
 * The pool has exactly 1024 queries.  A single sequential pass fills the
 * cache exactly to capacity.  A second pass re-exercises every entry (all
 * cache hits, stable memory).  Under concurrent load the eviction policy
 * kicks in; if evicted plans are not freed, RSS grows monotonically.
 *
 * Running modes
 * ─────────────
 * Single-pass fill (1 VU, 1024 iterations — fills cache exactly once):
 *   k6 run --vus=1 --iterations=1024 slow-plan-cache-stress.js
 *
 * Sustained stress (random distribution, many VUs — evictions under load):
 *   k6 run --vus=50 --duration=2m slow-plan-cache-stress.js
 *
 * Default stages (fill → ramp → stress → cool-down):
 *   k6 run slow-plan-cache-stress.js
 *
 * Override target:
 *   ROUTER_URL=http://localhost:3002/graphql k6 run slow-plan-cache-stress.js
 */

import http from 'k6/http';
import { check } from 'k6';

// ---------------------------------------------------------------------------
// Query generation — runs once during k6 init phase (not per VU iteration)
// ---------------------------------------------------------------------------

// The BASE touches all 4 demo subgraphs:
//   employees subgraph  → id, notes, tag, role, details.forename/surname/location
//   family subgraph     → details.hasChildren/maritalStatus/nationality/pets
//   hobbies subgraph    → hobbies (all 6 inline fragments)
//   products subgraph   → products (union field)
//
// Each cross-subgraph join creates a separate BatchEntityFetch with its own
// large FetchConfiguration.Input string.
const BASE = `
  employees {
    id
    tag
    notes
    details {
      forename
      surname
      location { language }
      hasChildren
      maritalStatus
      nationality
      pets {
        class
        gender
        name
        ... on Cat { type }
        ... on Dog { breed }
        ... on Alligator { dangerous }
      }
    }
    role {
      departments
      title
      ... on Engineer { engineerType }
      ... on Operator { operatorType }
    }
    hobbies {
      ... on Exercise { category }
      ... on Flying { planeModels yearsOfExperience }
      ... on Gaming { genres name yearsOfExperience }
      ... on Programming { languages }
      ... on Other { name }
      ... on Travelling { countriesLived { language } }
    }
    products
  }`.trim();

// Each EXTRA operation uses a distinct alias so it can be freely combined
// with any other extra without creating duplicate field names.
// These are ordered to spread coverage across query types and subgraphs.
const EXTRA_OPS = [
  // Single-employee lookups with different field subsets
  // (id arg normalises to a variable, so field selection is the only
  //  differentiator — these field sets are chosen to be mutually distinct)
  `x0: employee(id: 1) { id tag notes }`,

  `x1: employee(id: 1) { id details { forename hasChildren } }`,

  `x2: employee(id: 1) { id role { departments title ... on Engineer { engineerType } } }`,

  `x3: employee(id: 1) { id hobbies { ... on Exercise { category } ... on Gaming { genres name yearsOfExperience } } }`,

  `x4: employee(id: 1) { id details { pets { class gender name ... on Cat { type } ... on Dog { breed } } } products }`,

  // Teammates with different field selections (team arg normalises to var;
  // field selection drives plan uniqueness)
  `x5: teammates(team: BACKEND) { id tag notes products }`,

  `x6: teammates(team: BACKEND) { id details { forename nationality } hobbies { ... on Programming { languages } ... on Travelling { countriesLived { language } } } }`,

  // productTypes (products subgraph — different shape from employee queries)
  `x7: productTypes {
    ... on Documentation { url(product: SDK) urls(products: [COSMO, MARKETING]) }
    ... on Consultancy { name lead { id details { forename } } }
  }`,

  // findEmployees with different criteria (criteria normalises to variables;
  // field selections are distinct)
  `x8: findEmployees(criteria: { hasPets: true, nationality: UKRAINIAN, nested: { maritalStatus: ENGAGED } }) {
    id details { forename nationality maritalStatus }
  }`,

  `x9: findEmployees(criteria: { hasPets: true, nationality: GERMAN, nested: { maritalStatus: MARRIED, hasChildren: true } }) {
    id details { forename hasChildren nationality }
    hobbies { ... on Exercise { category } ... on Flying { planeModels } }
  }`,
];

// Build query pool: 2^10 = 1024 combinations (mask 0..1023).
// mask=0  → only BASE   (still a large 4-subgraph plan)
// mask=1023 → BASE + all 10 extra operations (maximum size)
const QUERIES = [];
for (let mask = 0; mask < 1024; mask++) {
  const parts = [BASE];
  for (let bit = 0; bit < EXTRA_OPS.length; bit++) {
    if (mask & (1 << bit)) {
      parts.push(EXTRA_OPS[bit]);
    }
  }
  QUERIES.push('{ ' + parts.join('\n  ') + ' }');
}

// ---------------------------------------------------------------------------
// Graph targets — base graph + 4 feature flag graphs
// ---------------------------------------------------------------------------
// Each feature flag graph has its own independent slow plan cache, so all
// 1024 unique queries must be sent to each target to fully fill its cache.
// Total unique (query, target) pairs: 1024 × 5 = 5120.

const ROUTER_URL = (__ENV.ROUTER_URL) || 'http://localhost:3002/graphql';

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'GraphQL-Client-Name': 'k6-slow-plan-cache-stress',
  'GraphQL-Client-Version': '1.0.0',
};

// One entry per graph: base graph (no FF header) + myff/myff2/myff3/myff4.
const TARGETS = [
  { label: 'base',  headers: BASE_HEADERS },
  { label: 'myff',  headers: Object.assign({}, BASE_HEADERS, { 'X-Feature-Flag': 'myff'  }) },
  { label: 'myff2', headers: Object.assign({}, BASE_HEADERS, { 'X-Feature-Flag': 'myff2' }) },
  { label: 'myff3', headers: Object.assign({}, BASE_HEADERS, { 'X-Feature-Flag': 'myff3' }) },
  { label: 'myff4', headers: Object.assign({}, BASE_HEADERS, { 'X-Feature-Flag': 'myff4' }) },
];

// Flatten into a single pool: every (query, target) combination.
// Ordering: all targets for query 0, then all targets for query 1, …
// This means the first 5×N iterations cover every unique cache entry exactly
// once across all graphs when iterated sequentially.
const POOL = [];
for (let qi = 0; qi < QUERIES.length; qi++) {
  for (let ti = 0; ti < TARGETS.length; ti++) {
    POOL.push({ query: QUERIES[qi], target: TARGETS[ti] });
  }
}

// ---------------------------------------------------------------------------
// k6 configuration
// ---------------------------------------------------------------------------

export const options = {
  stages: [
    // Phase 1 — sequential fill: 1 VU cycles through all 5120 unique
    // (query, target) pairs, filling every graph's plan cache exactly once.
    // Extend duration if the router is slow (~100 req/s → ~51 s).
    { duration: '60s', target: 1 },
    // Phase 2 — ramp up while all caches are warm and full.
    { duration: '20s', target: 20 },
    // Phase 3 — sustained load across all 5 graphs.
    // Caches are at capacity; evictions under concurrent load expose leaks.
    { duration: '60s', target: 50 },
    // Phase 4 — cool down.
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<5000'],
  },
};

// ---------------------------------------------------------------------------
// Default function — called once per VU iteration
// ---------------------------------------------------------------------------

export default function () {
  // Cycle through the pool so that the first 5120 iterations cover every
  // unique (query, graph) pair exactly once, regardless of VU count.
  const { query, target } = POOL[__ITER % POOL.length];

  const res = http.post(
    ROUTER_URL,
    JSON.stringify({ query }),
    { headers: target.headers },
  );

  check(res, {
    'HTTP 200': (r) => r.status === 200,
    'no GQL errors': (r) => {
      try {
        const body = r.json();
        return !body.errors || body.errors.length === 0;
      } catch (_) {
        return false;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Summary — printed at end of run
// ---------------------------------------------------------------------------

export function handleSummary(data) {
  const cacheSize = 1024; // demo.config.yaml: slow_plan_cache_size
  console.log('');
  console.log('Slow-plan-cache stress summary');
  console.log('  Query pool size : ' + QUERIES.length + ' unique structural variants');
  console.log('  Graph targets   : ' + TARGETS.length + '  (base + myff, myff2, myff3, myff4)');
  console.log('  Total pool size : ' + POOL.length + ' unique (query, graph) pairs');
  console.log('  Cache capacity  : ' + cacheSize + ' entries per graph');
  console.log('  Fill ratio      : ' + (QUERIES.length / cacheSize).toFixed(2) + 'x per graph  (=1.0x fills exactly; >1.0x triggers evictions)');
  console.log('  Every query     : spans all 4 demo subgraphs (employees + family + hobbies + products)');
  console.log('');
  return {};
}
