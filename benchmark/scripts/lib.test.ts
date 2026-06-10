import assert from "node:assert/strict";
import test from "node:test";

import {
  buildK6Stages,
  buildSuiteSummary,
  extractComparableModeSummary,
  fetchJsonWithRetry,
  loadManifest,
  normalizeJson,
  normalizeResponseForComparison,
  parseDockerStatsSummary,
  parseRedisInfoSummary,
  resolveHeaders,
  resolveRequestMatrix,
  resolveScenario,
} from "./lib";

test("normalizeJson sorts object keys and preserves array order", () => {
  const input = {
    z: 1,
    a: {
      y: 2,
      x: 3,
    },
    arr: [
      { b: 2, a: 1 },
      { d: 4, c: 3 },
    ],
  };

  assert.deepEqual(normalizeJson(input), {
    a: {
      x: 3,
      y: 2,
    },
    arr: [
      { a: 1, b: 2 },
      { c: 3, d: 4 },
    ],
    z: 1,
  });
});

test("loadManifest returns the benchmark scenarios", () => {
  const manifest = loadManifest();

  assert.ok(manifest.scenarios.length >= 8);
  assert.ok(
    manifest.scenarios.some(
      (scenario) => scenario.name === "viewer_articles_deep_nested",
    ),
  );
});

test("resolveRequestMatrix expands auth matrices and fixture paths", () => {
  const manifest = loadManifest();
  const scenario = manifest.scenarios.find(
    (item) => item.name === "user_profile_header_sensitive",
  );

  assert.ok(scenario);

  const matrix = resolveRequestMatrix(scenario);

  assert.deepEqual(
    matrix.map((item) => item.authProfile),
    ["alice", "bob"],
  );
  assert.equal(
    matrix[0]?.fixturePath.endsWith(
      "benchmark/fixtures/user_profile_header_sensitive.alice.response.json",
    ),
    true,
  );
});

test("buildK6Stages creates deterministic stage layout", () => {
  assert.deepEqual(
    buildK6Stages({
      vus: 25,
      duration: "90s",
      rampUp: "15s",
      rampDown: "5s",
    }),
    [
      { duration: "15s", target: 25 },
      { duration: "90s", target: 25 },
      { duration: "5s", target: 0 },
    ],
  );
});

test("parseRedisInfoSummary keeps selected runtime fields", () => {
  const raw = `# Memory
used_memory:1024
used_memory_human:1.00K
used_memory_peak:2048
connected_clients:3
total_commands_processed:42
keyspace_hits:7
keyspace_misses:2
db2:keys=12,expires=0,avg_ttl=0
`;

  assert.deepEqual(parseRedisInfoSummary(raw), {
    used_memory: 1024,
    used_memory_human: "1.00K",
    used_memory_peak: 2048,
    connected_clients: 3,
    total_commands_processed: 42,
    keyspace_hits: 7,
    keyspace_misses: 2,
    db2: "keys=12,expires=0,avg_ttl=0",
  });
});

test("parseDockerStatsSummary keeps the expected docker stats fields", () => {
  assert.deepEqual(
    parseDockerStatsSummary(
      JSON.stringify({
        CPUPerc: "1.23%",
        MemUsage: "12.3MiB / 1GiB",
        NetIO: "1kB / 2kB",
        BlockIO: "0B / 0B",
        PIDs: "9",
        Name: "ignored",
      }),
    ),
    {
      CPUPerc: "1.23%",
      MemUsage: "12.3MiB / 1GiB",
      NetIO: "1kB / 2kB",
      BlockIO: "0B / 0B",
      PIDs: "9",
    },
  );
});

test("resolveHeaders enables trace so benchmark cache controls are honored", () => {
  const scenario = resolveScenario("article_simple");

  expectHeaders(resolveHeaders(scenario, "entity_cache_disabled", undefined, "bench-a"), {
    "X-WG-Trace": "enable_predictable_debug_timings",
    "X-WG-Disable-Entity-Cache": "true",
    "X-WG-Cache-Key-Prefix": "bench-a",
  });

  expectHeaders(resolveHeaders(scenario, "cache_enabled", undefined, "bench-b"), {
    "X-WG-Trace": "enable_predictable_debug_timings",
    "X-WG-Cache-Key-Prefix": "bench-b",
  });
});

test("normalizeResponseForComparison strips trace extensions and removes empty extensions", () => {
  const response = {
    data: {
      article: {
        id: "a1",
        title: "Example",
      },
    },
    extensions: {
      trace: {
        version: "1",
        fetches: [],
      },
    },
  };

  assert.deepEqual(normalizeResponseForComparison(response), {
    data: {
      article: {
        id: "a1",
        title: "Example",
      },
    },
  });
});

test("fetchJsonWithRetry retries once for retryable fetch pipe errors", async () => {
  let calls = 0;

  const result = await fetchJsonWithRetry({
    url: "http://example.test/graphql",
    init: {
      method: "POST",
      body: "{}",
    },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new TypeError("fetch failed") as TypeError & {
          cause?: { code?: string };
        };
        error.cause = { code: "EPIPE" };
        throw error;
      }

      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { data: { ok: true } });
});

test("fetchJsonWithRetry aborts a slow attempt via per-attempt timeout and retries", async () => {
  let calls = 0;

  const result = await fetchJsonWithRetry({
    url: "http://example.test/graphql",
    init: {
      method: "POST",
      body: "{}",
    },
    timeoutMs: 50,
    retries: 2,
    fetchImpl: async (_url, opts) => {
      calls += 1;
      const signal = (opts as RequestInit | undefined)?.signal;

      if (calls === 1) {
        // Simulate a hang that only resolves when the per-attempt timeout fires.
        await new Promise((_resolve, reject) => {
          if (!signal) {
            return;
          }
          signal.addEventListener("abort", () => {
            reject(signal.reason ?? new DOMException("aborted", "AbortError"));
          });
        });
        throw new Error("unreachable");
      }

      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { data: { ok: true } });
});

test("fetchJsonWithRetry gives up after exhausting retries on repeated timeouts", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchJsonWithRetry({
        url: "http://example.test/graphql",
        init: {
          method: "POST",
          body: "{}",
        },
        timeoutMs: 20,
        retries: 2,
        fetchImpl: async (_url, opts) => {
          calls += 1;
          const signal = (opts as RequestInit | undefined)?.signal;
          await new Promise((_resolve, reject) => {
            if (!signal) {
              return;
            }
            signal.addEventListener("abort", () => {
              reject(signal.reason ?? new DOMException("aborted", "AbortError"));
            });
          });
          throw new Error("unreachable");
        },
      }),
    (error: unknown) => {
      const name = (error as { name?: string } | null)?.name;
      return name === "TimeoutError" || name === "AbortError";
    },
  );

  // retries=2 → attempts 0, 1, 2 → 3 total calls
  assert.equal(calls, 3);
});

test("fetchJsonWithRetry bubbles AbortError when the caller cancels", async () => {
  const controller = new AbortController();
  let calls = 0;

  const pending = fetchJsonWithRetry({
    url: "http://example.test/graphql",
    init: {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    },
    timeoutMs: 5_000,
    retries: 3,
    fetchImpl: async (_url, opts) => {
      calls += 1;
      const signal = (opts as RequestInit | undefined)?.signal;
      await new Promise((_resolve, reject) => {
        if (!signal) {
          return;
        }
        signal.addEventListener("abort", () => {
          reject(signal.reason ?? new DOMException("aborted", "AbortError"));
        });
      });
      throw new Error("unreachable");
    },
  });

  // Cancel shortly after dispatch.
  setTimeout(() => controller.abort(new DOMException("caller cancelled", "AbortError")), 20);

  await assert.rejects(pending, (error: unknown) => {
    return (error as { name?: string } | null)?.name === "AbortError";
  });

  // Caller cancellation must NOT trigger further retry attempts.
  assert.equal(calls, 1);
});

test("fetchJsonWithRetry returns parsed JSON on happy path without retries", async () => {
  let calls = 0;

  const result = await fetchJsonWithRetry({
    url: "http://example.test/graphql",
    init: { method: "POST", body: "{}" },
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: { hello: "world" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, { data: { hello: "world" } });
});

test("fetchJsonWithRetry does not retry non-retryable fetch failures", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchJsonWithRetry({
        url: "http://example.test/graphql",
        init: {
          method: "POST",
          body: "{}",
        },
        fetchImpl: async () => {
          calls += 1;
          const error = new TypeError("fetch failed") as TypeError & {
            cause?: { code?: string };
          };
          error.cause = { code: "ENOTFOUND" };
          throw error;
        },
      }),
    /fetch failed/,
  );

  assert.equal(calls, 1);
});

test("extractComparableModeSummary reads stable comparison metrics from mode artifacts", () => {
  const modeSummary = extractComparableModeSummary({
    modePath:
      "/tmp/results/article_simple/cache_enabled",
    summaryDocument: {
      scenario: "article_simple",
      mode: "cache_enabled",
      authProfile: null,
      fixturePath: "benchmark/fixtures/article_simple.response.json",
      k6: {
        summary: {
          metrics: {
            http_reqs: {
              count: 1000,
              rate: 250,
            },
            http_req_duration: {
              avg: 4,
              "p(95)": 7,
            },
            iterations: {
              count: 1000,
              rate: 250,
            },
            http_req_failed: {
              value: 0,
            },
            graphql_error_rate: {
              value: 0,
            },
            response_mismatch_rate: {
              value: 0,
            },
          },
        },
      },
      redis: {
        infoAfter: {
          used_memory: 4096,
          used_memory_peak: 8192,
          total_commands_processed: 120,
          keyspace_hits: 90,
          keyspace_misses: 30,
        },
        dockerStatsAfter: {
          CPUPerc: "12.5%",
          MemUsage: "16MiB / 1GiB",
        },
      },
    },
    metricsDeltaDocument: {
      go_goroutines: 3,
      go_memstats_alloc_bytes: 2048,
      go_memstats_heap_alloc_bytes: 1024,
      process_resident_memory_bytes: 512,
      process_cpu_seconds_total: 1.5,
      'router_entity_cache_requests_stats_total{cache_level="l1",type="hits"}': 11,
      'router_entity_cache_requests_stats_total{cache_level="l1",type="misses"}': 2,
      'router_entity_cache_requests_stats_total{cache_level="l2",type="hits"}': 95,
      'router_entity_cache_requests_stats_total{cache_level="l2",type="misses"}': 5,
      'router_entity_cache_populations_total{source="query"}': 5,
      'router_entity_cache_keys_stats_total{cache_level="l2",operation="added"}': 5,
    },
  });

  assert.deepEqual(modeSummary, {
    scenario: "article_simple",
    mode: "cache_enabled",
    authProfile: null,
    fixturePath: "benchmark/fixtures/article_simple.response.json",
    modePath: "/tmp/results/article_simple/cache_enabled",
    requests: 1000,
    requestRate: 250,
    iterationCount: 1000,
    iterationRate: 250,
    latencyAvgMs: 4,
    latencyP95Ms: 7,
    httpFailureRate: 0,
    graphqlErrorRate: 0,
    responseMismatchRate: 0,
    cache: {
      l1Hits: 11,
      l1Misses: 2,
      l2Hits: 95,
      l2Misses: 5,
      populations: 5,
      keysAdded: 5,
    },
    router: {
      goroutinesDelta: 3,
      allocBytesDelta: 2048,
      heapAllocBytesDelta: 1024,
      residentMemoryBytesDelta: 512,
      cpuSecondsDelta: 1.5,
    },
    redis: {
      usedMemoryBytes: 4096,
      peakMemoryBytes: 8192,
      commandsProcessed: 120,
      keyspaceHits: 90,
      keyspaceMisses: 30,
      dockerCpuPercent: "12.5%",
      dockerMemoryUsage: "16MiB / 1GiB",
    },
  });
});

test("buildSuiteSummary groups scenario variants and computes canonical mode comparisons", () => {
  const suite = buildSuiteSummary({
    resultsRoot: "/tmp/results/run-1",
    generatedAt: "2026-04-08T12:00:00.000Z",
    modeSummaries: [
      {
        scenario: "article_simple",
        mode: "entity_cache_disabled",
        authProfile: null,
        fixturePath: "benchmark/fixtures/article_simple.response.json",
        modePath: "/tmp/results/run-1/article_simple/entity_cache_disabled",
        requests: 100,
        requestRate: 50,
        iterationCount: 100,
        iterationRate: 50,
        latencyAvgMs: 80,
        latencyP95Ms: 100,
        httpFailureRate: 0,
        graphqlErrorRate: 0,
        responseMismatchRate: 0,
        cache: {
          l1Hits: 0,
          l1Misses: 0,
          l2Hits: 0,
          l2Misses: 0,
          populations: 0,
          keysAdded: 0,
        },
        router: {
          goroutinesDelta: 2,
          allocBytesDelta: 4000,
          heapAllocBytesDelta: 3000,
          residentMemoryBytesDelta: 1200,
          cpuSecondsDelta: 2,
        },
        redis: {
          usedMemoryBytes: 2048,
          peakMemoryBytes: 4096,
          commandsProcessed: 20,
          keyspaceHits: 0,
          keyspaceMisses: 0,
          dockerCpuPercent: "1%",
          dockerMemoryUsage: "8MiB / 1GiB",
        },
      },
      {
        scenario: "article_simple",
        mode: "cache_enabled",
        authProfile: null,
        fixturePath: "benchmark/fixtures/article_simple.response.json",
        modePath: "/tmp/results/run-1/article_simple/cache_enabled",
        requests: 1000,
        requestRate: 500,
        iterationCount: 1000,
        iterationRate: 500,
        latencyAvgMs: 4,
        latencyP95Ms: 6,
        httpFailureRate: 0,
        graphqlErrorRate: 0,
        responseMismatchRate: 0,
        cache: {
          l1Hits: 0,
          l1Misses: 0,
          l2Hits: 900,
          l2Misses: 100,
          populations: 100,
          keysAdded: 100,
        },
        router: {
          goroutinesDelta: 1,
          allocBytesDelta: 1000,
          heapAllocBytesDelta: 800,
          residentMemoryBytesDelta: 400,
          cpuSecondsDelta: 0.5,
        },
        redis: {
          usedMemoryBytes: 16384,
          peakMemoryBytes: 32768,
          commandsProcessed: 250,
          keyspaceHits: 900,
          keyspaceMisses: 100,
          dockerCpuPercent: "4%",
          dockerMemoryUsage: "16MiB / 1GiB",
        },
      },
      {
        scenario: "request_scoped_viewer_articles",
        mode: "request_scoped_l1_disabled",
        authProfile: "alice",
        fixturePath:
          "benchmark/fixtures/request_scoped_viewer_articles.response.json",
        modePath:
          "/tmp/results/run-1/request_scoped_viewer_articles/request_scoped_l1_disabled-alice",
        requests: 100,
        requestRate: 20,
        iterationCount: 100,
        iterationRate: 20,
        latencyAvgMs: 40,
        latencyP95Ms: 55,
        httpFailureRate: 0,
        graphqlErrorRate: 0,
        responseMismatchRate: 0,
        cache: {
          l1Hits: 0,
          l1Misses: 100,
          l2Hits: 0,
          l2Misses: 0,
          populations: 0,
          keysAdded: 0,
        },
        router: {
          goroutinesDelta: 1,
          allocBytesDelta: 5000,
          heapAllocBytesDelta: 4500,
          residentMemoryBytesDelta: 2000,
          cpuSecondsDelta: 1.5,
        },
        redis: {
          usedMemoryBytes: 0,
          peakMemoryBytes: 0,
          commandsProcessed: 0,
          keyspaceHits: 0,
          keyspaceMisses: 0,
          dockerCpuPercent: "0%",
          dockerMemoryUsage: "6MiB / 1GiB",
        },
      },
      {
        scenario: "request_scoped_viewer_articles",
        mode: "request_scoped_default",
        authProfile: "alice",
        fixturePath:
          "benchmark/fixtures/request_scoped_viewer_articles.response.json",
        modePath:
          "/tmp/results/run-1/request_scoped_viewer_articles/request_scoped_default-alice",
        requests: 100,
        requestRate: 40,
        iterationCount: 100,
        iterationRate: 40,
        latencyAvgMs: 20,
        latencyP95Ms: 30,
        httpFailureRate: 0,
        graphqlErrorRate: 0,
        responseMismatchRate: 0,
        cache: {
          l1Hits: 60,
          l1Misses: 40,
          l2Hits: 0,
          l2Misses: 0,
          populations: 0,
          keysAdded: 0,
        },
        router: {
          goroutinesDelta: 1,
          allocBytesDelta: 2000,
          heapAllocBytesDelta: 1800,
          residentMemoryBytesDelta: 900,
          cpuSecondsDelta: 0.8,
        },
        redis: {
          usedMemoryBytes: 0,
          peakMemoryBytes: 0,
          commandsProcessed: 0,
          keyspaceHits: 0,
          keyspaceMisses: 0,
          dockerCpuPercent: "0%",
          dockerMemoryUsage: "6MiB / 1GiB",
        },
      },
    ],
  });

  assert.equal(suite.resultsRoot, "/tmp/results/run-1");
  assert.equal(suite.generatedAt, "2026-04-08T12:00:00.000Z");
  assert.equal(suite.scenarios.length, 2);

  assert.deepEqual(suite.scenarios[0], {
    scenario: "article_simple",
    authProfile: null,
    modes: ["entity_cache_disabled", "cache_enabled"],
    summaries: [
      suite.scenarios[0]?.summaries[0],
      suite.scenarios[0]?.summaries[1],
    ],
    comparisons: [
      {
        baselineMode: "entity_cache_disabled",
        candidateMode: "cache_enabled",
        requestRateMultiplier: 10,
        latencyAvgImprovement: 20,
        latencyP95Improvement: 16.666666666666668,
      },
    ],
  });

  assert.deepEqual(suite.scenarios[1], {
    scenario: "request_scoped_viewer_articles",
    authProfile: "alice",
    modes: ["request_scoped_l1_disabled", "request_scoped_default"],
    summaries: [
      suite.scenarios[1]?.summaries[0],
      suite.scenarios[1]?.summaries[1],
    ],
    comparisons: [
      {
        baselineMode: "request_scoped_l1_disabled",
        candidateMode: "request_scoped_default",
        requestRateMultiplier: 2,
        latencyAvgImprovement: 2,
        latencyP95Improvement: 1.8333333333333333,
      },
    ],
  });
});

function expectHeaders(
  actual: Record<string, string>,
  expectedSubset: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(expectedSubset)) {
    assert.equal(actual[key], value);
  }
}
