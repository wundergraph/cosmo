// F06 · KI-DEFER-UNBOUNDED-FANOUT-DOS · SYS-REQ-779 · HIGH
//
// The parallel branch of resolveDeferTree spawns each sibling defer group under a plain
// errgroup.Group with NO SetLimit; the engine maxConcurrency semaphore is acquired ONCE per
// request, not per sibling. So N sibling @defer fragments fan out into N concurrent outbound
// subgraph fetches REGARDLESS of the configured ENGINE_MAX_CONCURRENT_RESOLVERS.
//
// HARD-RED setup: run the router with a LOW limit:
//   ENGINE_MAX_CONCURRENT_RESOLVERS=2 EXECUTION_CONFIG_FILE_PATH=.../config.json DEV_MODE=true \
//     LISTEN_ADDR=localhost:3002 ./cosmo-router
//
// Each deferred fetch sleeps ~150ms (reviews/recommendations mock latency). With a single
// deferred fetch as the baseline T1, a spec-conforming engine that honors the limit L=2 must
// throttle 5 sibling fetches into ceil(5/2)=3 waves => ~3*T1. The bug runs all 5 in ONE wave
// => ~1*T1. We assert the throttling ratio (machine-speed-independent); it fails today.
import { describe, it, expect } from "vitest";

const ROUTER = process.env.ROUTER_URL || "http://127.0.0.1:3002/graphql";
const LIMIT = Number(process.env.EXPECTED_MAX_CONCURRENCY || 2); // must match ENGINE_MAX_CONCURRENT_RESOLVERS

async function timeIt(query: string): Promise<number> {
  const t0 = Date.now();
  const r = await fetch(ROUTER, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "multipart/mixed" },
    body: JSON.stringify({ query }),
  });
  await r.text();
  return Date.now() - t0;
}

const SINGLE = `{ a1: article(id:"a1"){ id ... @defer { reviews { id } } } }`;
// 5 sibling @defer groups, each a distinct cross-subgraph deferred fetch on a CLEAN entity
// (3 reviews fetches + 2 recommendations fetches), all ~150ms:
const FANOUT5 = `{
  a1: article(id:"a1"){ id ... @defer { reviews { id } } }
  a2: article(id:"a2"){ id ... @defer { reviews { id } } }
  p1: podcast(id:"p1"){ id ... @defer { reviews { id } } }
  u2: user(id:"u2"){ id ... @defer { reviews { id } } }
  u1: user(id:"u1"){ id ... @defer { recommendedArticles { id } } }
}`;

describe("F06 KI-DEFER-UNBOUNDED-FANOUT-DOS (REPRODUCED_HTTP, needs ENGINE_MAX_CONCURRENT_RESOLVERS=2)", () => {
  it("must bound parallel @defer fan-out by the resolver concurrency limit", { timeout: 30000, retry: 1 }, async () => {
    await timeIt(SINGLE);              // warm up (avoid first-request planning cost skewing the baseline)
    const t1 = await timeIt(SINGLE);   // one deferred fetch ~= one 150ms wave
    const t5 = await timeIt(FANOUT5);  // five sibling deferred fetches
    const ratio = t5 / t1;
    const expectedWaves = Math.ceil(5 / LIMIT); // =3 for L=2
    // Spec-conforming: 5 fetches throttled to L per wave => ~expectedWaves waves => ratio ~= expectedWaves.
    // The bug runs ALL of them in ONE wave (ratio ~1). Require real throttling (>= ~2 waves of latency).
    // eslint-disable-next-line no-console
    console.log(`[F06] t1=${t1}ms t5=${t5}ms ratio=${ratio.toFixed(2)} (limit=${LIMIT}, expected ~${expectedWaves} waves)`);
    expect(ratio).toBeGreaterThanOrEqual(2.0);
  });
});
