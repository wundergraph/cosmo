import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Mode =
  | "cache_enabled"
  | "entity_cache_disabled"
  | "request_scoped_default"
  | "request_scoped_l1_disabled";

export type AuthProfile = "alice" | "bob" | "charlie";

export type Scenario = {
  name: string;
  queryFile: string;
  operationName: string;
  responseFixture?: string;
  responseFixtures?: Partial<Record<AuthProfile, string>>;
  variables: Record<string, unknown>;
  modeFamily: string;
  warmupRequests: number;
  headers?: Record<string, string>;
  authProfile?: AuthProfile;
  authProfiles?: AuthProfile[];
  equivalenceModes: Mode[];
};

export type Manifest = {
  scenarios: Scenario[];
};

export type RequestVariant = {
  authProfile?: AuthProfile;
  fixturePath: string;
};

export type K6Stage = {
  duration: string;
  target: number;
};

export type ComparableModeSummary = {
  scenario: string;
  mode: string;
  authProfile: string | null;
  fixturePath: string;
  modePath: string;
  requests: number;
  requestRate: number;
  iterationCount: number;
  iterationRate: number;
  latencyAvgMs: number;
  latencyP95Ms: number;
  httpFailureRate: number;
  graphqlErrorRate: number;
  responseMismatchRate: number;
  cache: {
    l1Hits: number;
    l1Misses: number;
    l2Hits: number;
    l2Misses: number;
    populations: number;
    keysAdded: number;
  };
  router: {
    goroutinesDelta: number;
    allocBytesDelta: number;
    heapAllocBytesDelta: number;
    residentMemoryBytesDelta: number | null;
    cpuSecondsDelta: number | null;
  };
  redis: {
    usedMemoryBytes: number | null;
    peakMemoryBytes: number | null;
    commandsProcessed: number | null;
    keyspaceHits: number | null;
    keyspaceMisses: number | null;
    dockerCpuPercent: string;
    dockerMemoryUsage: string;
  };
};

export type ModeComparison = {
  baselineMode: string;
  candidateMode: string;
  requestRateMultiplier: number | null;
  latencyAvgImprovement: number | null;
  latencyP95Improvement: number | null;
};

export type ScenarioVariantSummary = {
  scenario: string;
  authProfile: string | null;
  modes: string[];
  summaries: ComparableModeSummary[];
  comparisons: ModeComparison[];
};

export type SuiteSummary = {
  generatedAt: string;
  resultsRoot: string;
  scenarios: ScenarioVariantSummary[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const AUTHORIZATION_BY_PROFILE: Record<AuthProfile, string> = {
  alice: "Bearer token-alice",
  bob: "Bearer token-bob",
  charlie: "Bearer token-charlie",
};

const MODE_ORDER: Record<string, number> = {
  entity_cache_disabled: 0,
  cache_enabled: 1,
  request_scoped_l1_disabled: 2,
  request_scoped_default: 3,
};

const COMPARISON_PAIRS: Array<readonly [baselineMode: string, candidateMode: string]> = [
  ["entity_cache_disabled", "cache_enabled"],
  ["request_scoped_l1_disabled", "request_scoped_default"],
];

export function repoRoot(): string {
  return REPO_ROOT;
}

export function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)]),
    );
  }

  return value;
}

export function normalizeResponseForComparison(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return normalizeJson(value);
  }

  const response = structuredClone(value as Record<string, unknown>);
  const extensions = response.extensions;

  if (extensions && typeof extensions === "object" && !Array.isArray(extensions)) {
    delete (extensions as Record<string, unknown>).trace;

    if (Object.keys(extensions as Record<string, unknown>).length === 0) {
      delete response.extensions;
    }
  }

  return normalizeJson(response);
}

export function loadManifest(): Manifest {
  const manifestPath = path.join(
    REPO_ROOT,
    "benchmark",
    "scenarios",
    "cache-demo.json",
  );

  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
}

export function resolveScenario(name: string): Scenario {
  const scenario = loadManifest().scenarios.find((item) => item.name === name);
  if (!scenario) {
    throw new Error(`unknown benchmark scenario: ${name}`);
  }
  return scenario;
}

export function resolveScenarioQuery(scenario: Scenario): string {
  return fs.readFileSync(path.join(REPO_ROOT, scenario.queryFile), "utf8");
}

export function resolveRequestMatrix(scenario: Scenario): RequestVariant[] {
  if (scenario.responseFixtures && scenario.authProfiles?.length) {
    return scenario.authProfiles.map((authProfile) => {
      const fixturePath = scenario.responseFixtures?.[authProfile];
      if (!fixturePath) {
        throw new Error(
          `missing fixture path for ${scenario.name} auth profile ${authProfile}`,
        );
      }
      return { authProfile, fixturePath };
    });
  }

  if (!scenario.responseFixture) {
    throw new Error(`scenario ${scenario.name} does not declare a response fixture`);
  }

  return [{ authProfile: scenario.authProfile, fixturePath: scenario.responseFixture }];
}

export function resolveHeaders(
  scenario: Scenario,
  mode: Mode,
  authProfile?: AuthProfile,
  cacheKeyPrefix?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "X-WG-Trace": "enable_predictable_debug_timings",
    ...(scenario.headers ?? {}),
  };

  if (authProfile) {
    headers.Authorization = AUTHORIZATION_BY_PROFILE[authProfile];
  }

  if (cacheKeyPrefix) {
    headers["X-WG-Cache-Key-Prefix"] = cacheKeyPrefix;
  }

  if (mode === "entity_cache_disabled") {
    headers["X-WG-Disable-Entity-Cache"] = "true";
  }

  if (mode === "request_scoped_l1_disabled") {
    headers["X-WG-Disable-Entity-Cache-L1"] = "true";
  }

  return headers;
}

export function readFixture(fixturePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, fixturePath), "utf8"));
}

export function buildK6Stages(input: {
  vus: number;
  duration: string;
  rampUp: string;
  rampDown: string;
}): K6Stage[] {
  return [
    { duration: input.rampUp, target: input.vus },
    { duration: input.duration, target: input.vus },
    { duration: input.rampDown, target: 0 },
  ];
}

export function parseRedisInfoSummary(raw: string): Record<string, string | number> {
  const selectedKeys = new Set([
    "used_memory",
    "used_memory_human",
    "used_memory_peak",
    "used_memory_peak_human",
    "connected_clients",
    "total_commands_processed",
    "keyspace_hits",
    "keyspace_misses",
  ]);
  const summary: Record<string, string | number> = {};

  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1).trim();

    if (key.startsWith("db")) {
      summary[key] = value;
      continue;
    }

    if (!selectedKeys.has(key)) {
      continue;
    }

    const numeric = Number(value);
    summary[key] = Number.isNaN(numeric) ? value : numeric;
  }

  return summary;
}

export function parseDockerStatsSummary(raw: string): Record<string, string> {
  const parsed = JSON.parse(raw) as Record<string, string>;

  return {
    CPUPerc: parsed.CPUPerc ?? "",
    MemUsage: parsed.MemUsage ?? "",
    NetIO: parsed.NetIO ?? "",
    BlockIO: parsed.BlockIO ?? "",
    PIDs: parsed.PIDs ?? "",
  };
}

export function validateManifest(manifest: Manifest): string[] {
  const errors: string[] = [];

  for (const scenario of manifest.scenarios) {
    if (!fs.existsSync(path.join(REPO_ROOT, scenario.queryFile))) {
      errors.push(`missing query file for ${scenario.name}: ${scenario.queryFile}`);
    }

    try {
      for (const variant of resolveRequestMatrix(scenario)) {
        if (!fs.existsSync(path.join(REPO_ROOT, variant.fixturePath))) {
          errors.push(
            `missing fixture for ${scenario.name}: ${variant.fixturePath}`,
          );
        }
      }
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : `invalid scenario: ${scenario.name}`,
      );
    }
  }

  return errors;
}

function readMetricNumber(
  metrics: Record<string, unknown>,
  metricName: string,
  field: string,
): number {
  const metric = metrics[metricName];
  if (!metric || typeof metric !== "object" || Array.isArray(metric)) {
    return 0;
  }

  const value = (metric as Record<string, unknown>)[field];
  return typeof value === "number" ? value : 0;
}

function readRecordNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function sumMetricValues(
  metricsDeltaDocument: Record<string, number>,
  requiredFragments: string[],
): number {
  let total = 0;

  for (const [key, value] of Object.entries(metricsDeltaDocument)) {
    if (requiredFragments.every((fragment) => key.includes(fragment))) {
      total += value;
    }
  }

  return total;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

export function extractComparableModeSummary(input: {
  modePath: string;
  summaryDocument: Record<string, unknown>;
  metricsDeltaDocument: Record<string, number>;
}): ComparableModeSummary {
  const k6 =
    input.summaryDocument.k6 &&
    typeof input.summaryDocument.k6 === "object" &&
    !Array.isArray(input.summaryDocument.k6)
      ? (input.summaryDocument.k6 as Record<string, unknown>)
      : {};
  const k6Summary =
    k6.summary && typeof k6.summary === "object" && !Array.isArray(k6.summary)
      ? (k6.summary as Record<string, unknown>)
      : {};
  const metrics =
    k6Summary.metrics &&
    typeof k6Summary.metrics === "object" &&
    !Array.isArray(k6Summary.metrics)
      ? (k6Summary.metrics as Record<string, unknown>)
      : {};
  const redis =
    input.summaryDocument.redis &&
    typeof input.summaryDocument.redis === "object" &&
    !Array.isArray(input.summaryDocument.redis)
      ? (input.summaryDocument.redis as Record<string, unknown>)
      : {};
  const redisInfo =
    redis.infoAfter &&
    typeof redis.infoAfter === "object" &&
    !Array.isArray(redis.infoAfter)
      ? (redis.infoAfter as Record<string, unknown>)
      : {};
  const dockerStats =
    redis.dockerStatsAfter &&
    typeof redis.dockerStatsAfter === "object" &&
    !Array.isArray(redis.dockerStatsAfter)
      ? (redis.dockerStatsAfter as Record<string, unknown>)
      : {};

  return {
    scenario: String(input.summaryDocument.scenario ?? ""),
    mode: String(input.summaryDocument.mode ?? ""),
    authProfile:
      input.summaryDocument.authProfile === null ||
      typeof input.summaryDocument.authProfile === "string"
        ? (input.summaryDocument.authProfile as string | null)
        : null,
    fixturePath: String(input.summaryDocument.fixturePath ?? ""),
    modePath: input.modePath,
    requests: readMetricNumber(metrics, "http_reqs", "count"),
    requestRate: readMetricNumber(metrics, "http_reqs", "rate"),
    iterationCount: readMetricNumber(metrics, "iterations", "count"),
    iterationRate: readMetricNumber(metrics, "iterations", "rate"),
    latencyAvgMs: readMetricNumber(metrics, "http_req_duration", "avg"),
    latencyP95Ms: readMetricNumber(metrics, "http_req_duration", "p(95)"),
    httpFailureRate: readMetricNumber(metrics, "http_req_failed", "value"),
    graphqlErrorRate: readMetricNumber(metrics, "graphql_error_rate", "value"),
    responseMismatchRate: readMetricNumber(
      metrics,
      "response_mismatch_rate",
      "value",
    ),
    cache: {
      l1Hits: sumMetricValues(input.metricsDeltaDocument, [
        "router_entity_cache_requests_stats_total",
        'cache_level="l1"',
        'type="hits"',
      ]),
      l1Misses: sumMetricValues(input.metricsDeltaDocument, [
        "router_entity_cache_requests_stats_total",
        'cache_level="l1"',
        'type="misses"',
      ]),
      l2Hits: sumMetricValues(input.metricsDeltaDocument, [
        "router_entity_cache_requests_stats_total",
        'cache_level="l2"',
        'type="hits"',
      ]),
      l2Misses: sumMetricValues(input.metricsDeltaDocument, [
        "router_entity_cache_requests_stats_total",
        'cache_level="l2"',
        'type="misses"',
      ]),
      populations: sumMetricValues(input.metricsDeltaDocument, [
        "router_entity_cache_populations_total",
      ]),
      keysAdded: sumMetricValues(input.metricsDeltaDocument, [
        "router_entity_cache_keys_stats_total",
        'operation="added"',
      ]),
    },
    router: {
      goroutinesDelta: input.metricsDeltaDocument.go_goroutines ?? 0,
      allocBytesDelta: input.metricsDeltaDocument.go_memstats_alloc_bytes ?? 0,
      heapAllocBytesDelta:
        input.metricsDeltaDocument.go_memstats_heap_alloc_bytes ?? 0,
      residentMemoryBytesDelta:
        input.metricsDeltaDocument.process_resident_memory_bytes ?? null,
      cpuSecondsDelta: input.metricsDeltaDocument.process_cpu_seconds_total ?? null,
    },
    redis: {
      usedMemoryBytes: readRecordNumber(redisInfo, "used_memory"),
      peakMemoryBytes: readRecordNumber(redisInfo, "used_memory_peak"),
      commandsProcessed: readRecordNumber(redisInfo, "total_commands_processed"),
      keyspaceHits: readRecordNumber(redisInfo, "keyspace_hits"),
      keyspaceMisses: readRecordNumber(redisInfo, "keyspace_misses"),
      dockerCpuPercent:
        typeof dockerStats.CPUPerc === "string" ? dockerStats.CPUPerc : "",
      dockerMemoryUsage:
        typeof dockerStats.MemUsage === "string" ? dockerStats.MemUsage : "",
    },
  };
}

export function buildSuiteSummary(input: {
  resultsRoot: string;
  generatedAt?: string;
  modeSummaries: ComparableModeSummary[];
}): SuiteSummary {
  const grouped = new Map<string, ScenarioVariantSummary>();

  for (const modeSummary of [...input.modeSummaries].sort((left, right) => {
    const scenarioCompare = left.scenario.localeCompare(right.scenario);
    if (scenarioCompare !== 0) {
      return scenarioCompare;
    }

    const authCompare = (left.authProfile ?? "").localeCompare(
      right.authProfile ?? "",
    );
    if (authCompare !== 0) {
      return authCompare;
    }

    const leftOrder = MODE_ORDER[left.mode] ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = MODE_ORDER[right.mode] ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.modePath.localeCompare(right.modePath);
  })) {
    const key = `${modeSummary.scenario}::${modeSummary.authProfile ?? ""}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.modes.push(modeSummary.mode);
      existing.summaries.push(modeSummary);
      continue;
    }

    grouped.set(key, {
      scenario: modeSummary.scenario,
      authProfile: modeSummary.authProfile,
      modes: [modeSummary.mode],
      summaries: [modeSummary],
      comparisons: [],
    });
  }

  const scenarios = [...grouped.values()];
  for (const scenario of scenarios) {
    const modeLookup = new Map(
      scenario.summaries.map((summary) => [summary.mode, summary]),
    );

    scenario.comparisons = COMPARISON_PAIRS.flatMap(
      ([baselineMode, candidateMode]) => {
        const baseline = modeLookup.get(baselineMode);
        const candidate = modeLookup.get(candidateMode);
        if (!baseline || !candidate) {
          return [];
        }

        return [
          {
            baselineMode,
            candidateMode,
            requestRateMultiplier: ratio(
              candidate.requestRate,
              baseline.requestRate,
            ),
            latencyAvgImprovement: ratio(
              baseline.latencyAvgMs,
              candidate.latencyAvgMs,
            ),
            latencyP95Improvement: ratio(
              baseline.latencyP95Ms,
              candidate.latencyP95Ms,
            ),
          },
        ];
      },
    );
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    resultsRoot: input.resultsRoot,
    scenarios,
  };
}

function formatFactor(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${value.toFixed(2)}x`;
}

export function renderSuiteSummaryMarkdown(summary: SuiteSummary): string {
  const lines: string[] = [
    "# Cache Demo Benchmark Suite Summary",
    "",
    `- Generated at: ${summary.generatedAt}`,
    `- Results root: ${summary.resultsRoot}`,
    "",
  ];

  for (const scenario of summary.scenarios) {
    lines.push(
      `## ${scenario.scenario}${scenario.authProfile ? ` (${scenario.authProfile})` : ""}`,
      "",
      "| Mode | req/s | avg ms | p95 ms | l1 hits | l2 hits | l2 misses | populations | alloc delta | heap delta | goroutines | redis used | redis commands |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );

    for (const mode of scenario.summaries) {
      lines.push(
        `| ${mode.mode} | ${mode.requestRate.toFixed(2)} | ${mode.latencyAvgMs.toFixed(2)} | ${mode.latencyP95Ms.toFixed(2)} | ${mode.cache.l1Hits} | ${mode.cache.l2Hits} | ${mode.cache.l2Misses} | ${mode.cache.populations} | ${mode.router.allocBytesDelta} | ${mode.router.heapAllocBytesDelta} | ${mode.router.goroutinesDelta} | ${mode.redis.usedMemoryBytes ?? "n/a"} | ${mode.redis.commandsProcessed ?? "n/a"} |`,
      );
    }

    if (scenario.comparisons.length > 0) {
      lines.push("", "Comparisons:");
      for (const comparison of scenario.comparisons) {
        lines.push(
          `- ${comparison.candidateMode} vs ${comparison.baselineMode}: req/s ${formatFactor(comparison.requestRateMultiplier)}, avg latency ${formatFactor(comparison.latencyAvgImprovement)}, p95 latency ${formatFactor(comparison.latencyP95Improvement)}`,
        );
      }
    }

    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof TypeError)) {
    return false;
  }

  const code =
    error &&
    typeof error === "object" &&
    "cause" in error &&
    error.cause &&
    typeof error.cause === "object" &&
    "code" in error.cause
      ? String((error.cause as { code?: unknown }).code ?? "")
      : "";

  return code === "EPIPE" || code === "ECONNRESET" || code === "UND_ERR_SOCKET";
}

function isTimeoutAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const name = (error as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export const FETCH_JSON_DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchJsonWithRetry(input: {
  url: string;
  init: RequestInit;
  fetchImpl?: typeof fetch;
  retries?: number;
  timeoutMs?: number;
}): Promise<unknown> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const retries = input.retries ?? 1;
  const timeoutMs = input.timeoutMs ?? FETCH_JSON_DEFAULT_TIMEOUT_MS;
  const callerSignal = input.init.signal ?? undefined;

  for (let attempt = 0; ; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutSignal])
      : timeoutSignal;

    try {
      const response = await fetchImpl(input.url, { ...input.init, signal });
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`request failed: ${response.status} ${body}`);
      }

      return JSON.parse(body);
    } catch (error) {
      // Caller explicitly cancelled — bubble immediately without retry.
      if (callerSignal?.aborted) {
        throw error;
      }

      const retryable =
        isRetryableFetchError(error) || isTimeoutAbortError(error);

      if (attempt >= retries || !retryable) {
        throw error;
      }

      await delay(100);
    }
  }
}

export async function runGraphQLRequest(input: {
  scenario: Scenario;
  query: string;
  headers: Record<string, string>;
  authProfile?: AuthProfile;
}): Promise<unknown> {
  try {
    return await fetchJsonWithRetry({
      url: "http://127.0.0.1:3002/graphql",
      init: {
        method: "POST",
        headers: {
          connection: "close",
          ...input.headers,
        },
        body: JSON.stringify({
          operationName: input.scenario.operationName,
          query: input.query,
          variables: input.scenario.variables ?? {},
        }),
      },
    });
  } catch (error) {
    throw new Error(
      `graphql request failed for ${input.scenario.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
