import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

/**
 * F07 · KI-DEFER-PARALLEL-SHARED-TREE-DATA-RACE · SYS-REQ-796
 *
 * Finding: when a query has two (or more) SIBLING @defer fragments on the SAME
 * entity that resolve from DIFFERENT subgraphs, the engine runs each defer
 * group's fetch concurrently against ONE shared response tree (DataBuffer).
 * The DataBuffer mutex serialises only the MERGE (write) phase; the FETCH
 * (read) phase of each sibling group runs with the lock RELEASED. A sibling
 * group then READS the shared parent entity node (to render the `_entities`
 * representation) WITHOUT the lock, while another sibling MERGES into that same
 * node UNDER the lock — an unsynchronised reader-vs-writer DATA RACE.
 *
 * Engine evidence (CONFIRMED present in our rc.267):
 *   - pkg/engine/resolve/data_buffer.go: DataBuffer.Lock/Unlock guard only when
 *     enableLock; Get()/Set() expose the shared *astjson.Value tree unguarded.
 *   - pkg/engine/resolve/resolve.go resolveDeferSingle (~L569-609): comment
 *     "Network I/O via ResolveFetchNode runs before the lock, allowing sibling
 *     defer fetches to overlap." Fetch runs OUTSIDE dc.db.Lock(); only the
 *     render/merge phase is under the lock. Siblings spawned via plain
 *     errgroup.Group in resolveDeferTree (~L630-645).
 *   - pkg/engine/resolve/loader.go resolveSingle (~L337-383): selectItemsForPath
 *     is taken under the lock, but the returned astjson `items` (pointers INTO
 *     the shared tree) are then read by loadEntityFetch -> InputTemplate.Render
 *     (~L1412) AFTER the lock is released; mergeResult writes under the lock
 *     (~L376 / loader.go:657 astjson.MergeValues -> Object.Set).
 *
 * Observed symptom (race-instrumented rc.267 router, GORACE history_size, driven
 * by the HTTP probe below — see /tmp/F07-router-race.log, 0 races before, 1 after):
 *
 *   WARNING: DATA RACE
 *   Write at 0x... by goroutine 365:
 *     astjson.(*Object).Set / MergeValues
 *     resolve.(*Loader).mergeResult                       loader.go:657
 *     resolve.(*Loader).resolveSingle                     loader.go:376
 *     resolve.(*Resolver).resolveDeferSingle              resolve.go:578
 *     resolve.(*Resolver).resolveDeferTree.func1          resolve.go:645
 *   Previous read at 0x... by goroutine 363:
 *     astjson.(*Value).GetStringBytes
 *     resolve.(*Resolvable).walkObject                    resolvable.go:906
 *     resolve.(*GraphQLVariableResolveRenderer).RenderVariable
 *     resolve.(*InputTemplate).Render                     inputtemplate.go:70
 *     resolve.(*Loader).loadEntityFetch                   loader.go:1412
 *     resolve.(*Loader).resolveSingle                     loader.go:371
 *     resolve.(*Resolver).resolveDeferSingle              resolve.go:578
 *     resolve.(*Resolver).resolveDeferTree.func1          resolve.go:645
 *   ...rooted in cosmo router/core/graphql_handler.go ServeHTTP (HTTP path).
 *
 * Overlap: this is BT-2 ("parallel-defer data race"), already reproduced; F07 is
 * the audit-side name (== SYS-REQ-796). Distinct from BT-1 / BT-3 / B1 / B6 / B7.
 *
 * Why no pure-wire RED assertion: the race is internal to the Go engine. On the
 * wire every response is a well-formed HTTP 200 multipart with correct data —
 * the corruption window is narrow and (on the demo dataset) does not flip the
 * delivered JSON. A spec-conforming engine MUST be free of data races, so the
 * correct property to assert is "no NEW `WARNING: DATA RACE` is emitted by the
 * router while this two-sibling-different-subgraph defer query is hammered".
 * That property is only observable against a -race-instrumented router whose
 * race output is captured to a file; set ROUTER_RACE_LOG (and point ROUTER_URL
 * at that race router) to make this a live RED test. The non-race router on
 * :3002 cannot surface the race, so without ROUTER_RACE_LOG the race assertion
 * is skipped (the load still runs to prove the path stays HTTP-healthy).
 *
 * Repro used for verification:
 *   ROUTER_URL=http://localhost:3012/graphql \
 *   ROUTER_RACE_LOG=/tmp/F07-router-race.log \
 *   vitest run ki-defer-parallel-shared-tree-data-race
 * (router = /tmp/cosmo-router-race, the -race build, on :3012).
 */

const ROUTER = process.env.ROUTER_URL || "http://localhost:3002/graphql";
const RACE_LOG = process.env.ROUTER_RACE_LOG; // path to the -race router's stderr/log

// Two sibling @defer fragments on the SAME entity (user u1) from DIFFERENT
// subgraphs: reviews (4103) and recommendations (4104). Each is a cross-subgraph
// _entities follow-up on the shared User node — the exact F07 trigger.
const QUERY = `query F07 {
  user(id: "u1") {
    id
    displayName
    ... @defer { reviews { id rating body } }
    ... @defer { recommendedArticles { id title } }
  }
}`;

interface FrameResult {
  status: number;
  ctype: string;
  frames: any[];
}

async function postDefer(): Promise<FrameResult> {
  const r = await fetch(ROUTER, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "multipart/mixed" },
    body: JSON.stringify({ query: QUERY }),
  });
  const ctype = r.headers.get("content-type") || "";
  const text = await r.text();
  const frames: any[] = [];
  for (const part of text.split(/\r?\n--graphql/)) {
    const sep = part.indexOf("\r\n\r\n") >= 0
      ? part.indexOf("\r\n\r\n") + 4
      : part.indexOf("\n\n") >= 0
        ? part.indexOf("\n\n") + 2
        : -1;
    if (sep < 0) continue;
    const body = part.slice(sep).trim();
    if (!body || body.startsWith("--")) continue;
    frames.push(JSON.parse(body));
  }
  return { status: r.status, ctype, frames };
}

function raceCount(): number {
  if (!RACE_LOG || !existsSync(RACE_LOG)) return 0;
  const txt = readFileSync(RACE_LOG, "utf8");
  return (txt.match(/WARNING: DATA RACE/g) || []).length;
}

describe("F07 KI-DEFER-PARALLEL-SHARED-TREE-DATA-RACE (REPRODUCED_HTTP, == BT-2)", () => {
  it("must not emit a data race for two sibling cross-subgraph @defer on the same entity", async () => {
    const before = raceCount();

    // Hammer the trigger with overlapping concurrent requests so the sibling
    // defer groups' fetch/merge phases interleave. 15 rounds x 4 concurrent.
    const ROUNDS = 15;
    const responses: FrameResult[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const batch = await Promise.all([postDefer(), postDefer(), postDefer(), postDefer()]);
      responses.push(...batch);
    }

    // The path itself must stay healthy: every response a 200 multipart with
    // the initial frame announcing exactly the two sibling defers.
    const allMultipart200 = responses.every(
      (r) => r.status === 200 && r.ctype.includes("multipart") && r.frames.length >= 1,
    );
    expect(allMultipart200).toBe(true);
    expect(responses[0].frames[0].pending).toEqual([
      { id: "1", path: ["user"] },
      { id: "2", path: ["user"] },
    ]);

    const after = raceCount();

    if (!RACE_LOG) {
      // Cannot observe the engine-internal race without a -race router log.
      // Document and skip the race assertion rather than fake a wire symptom.
      console.warn(
        "ROUTER_RACE_LOG not set: skipping the data-race assertion. " +
          "Point ROUTER_URL at a -race router and set ROUTER_RACE_LOG to make this RED.",
      );
      return;
    }

    // Spec-correct: a race-free engine emits ZERO new data races under this load.
    // Against the rc.267 -race router this FAILS (after > before) -> RED, proving
    // the unlocked-read vs locked-write race on the shared defer response tree.
    expect(after).toBe(before);
  }, 30_000);
});
