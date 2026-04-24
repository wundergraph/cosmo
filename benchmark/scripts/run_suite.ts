import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildK6Stages,
  buildSuiteSummary,
  extractComparableModeSummary,
  normalizeResponseForComparison,
  loadManifest,
  parseDockerStatsSummary,
  parseRedisInfoSummary,
  readFixture,
  renderSuiteSummaryMarkdown,
  resolveHeaders,
  resolveRequestMatrix,
  resolveScenario,
  resolveScenarioQuery,
  runGraphQLRequest,
  validateManifest,
} from "./lib";

function validate(): void {
  const manifest = loadManifest();
  const errors = validateManifest(manifest);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }

  for (const scenario of manifest.scenarios) {
    const fixturePaths = scenario.responseFixture
      ? [scenario.responseFixture]
      : Object.values(scenario.responseFixtures ?? {});
    console.log(`${scenario.name}: ${fixturePaths.join(", ")}`);
  }
}

export function parseArgs(argv: string[] = process.argv.slice(2)): {
  scenario?: string;
  all: boolean;
  vus: number;
  duration: string;
  rampUp: string;
  rampDown: string;
} {
  const args = argv;
  let scenario: string | undefined;
  let all = false;
  let vus = 20;
  let duration = "2m";
  let rampUp = "30s";
  let rampDown = "10s";

  const takeValue = (flag: string, idx: number): string => {
    const raw = args[idx + 1];
    if (raw === undefined || raw.startsWith("--")) {
      throw new Error(`missing value for ${flag}`);
    }
    return raw;
  };

  const parsePositiveInt = (flag: string, raw: string): number => {
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      throw new Error(`${flag} must be a positive integer, got "${raw}"`);
    }
    return n;
  };

  // Loose but enough to catch typos and missing values: "1s", "30s", "2m", "1h",
  // or a plain integer millisecond count ("500"). Rejects empty strings and
  // obviously malformed input like "30" with no unit followed by a letter.
  const durationPattern = /^\d+(ms|s|m|h)?$/;
  const parseDuration = (flag: string, raw: string): string => {
    if (!durationPattern.test(raw)) {
      throw new Error(`${flag} must look like 30s / 2m / 1h / 500ms, got "${raw}"`);
    }
    return raw;
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--scenario") {
      scenario = takeValue(arg, i);
      i += 1;
      continue;
    }
    if (arg === "--vus") {
      vus = parsePositiveInt(arg, takeValue(arg, i));
      i += 1;
      continue;
    }
    if (arg === "--duration") {
      duration = parseDuration(arg, takeValue(arg, i));
      i += 1;
      continue;
    }
    if (arg === "--ramp-up") {
      rampUp = parseDuration(arg, takeValue(arg, i));
      i += 1;
      continue;
    }
    if (arg === "--ramp-down") {
      rampDown = parseDuration(arg, takeValue(arg, i));
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return { scenario, all, vus, duration, rampUp, rampDown };
}

async function verifyScenarioEquivalence(scenarioName: string): Promise<void> {
  const scenario = resolveScenario(scenarioName);
  const query = resolveScenarioQuery(scenario);

  for (const variant of resolveRequestMatrix(scenario)) {
    const fixture = JSON.stringify(
      normalizeResponseForComparison(readFixture(variant.fixturePath)),
    );

    for (const mode of scenario.equivalenceModes) {
      const live = await runGraphQLRequest({
        scenario,
        query,
        authProfile: variant.authProfile,
        headers: resolveHeaders(
          scenario,
          mode,
          variant.authProfile,
          `suite-${scenario.name}-${mode}-${Date.now()}`,
        ),
      });

      if (JSON.stringify(normalizeResponseForComparison(live)) !== fixture) {
        throw new Error(
          `equivalence failed for ${scenario.name} mode=${mode} auth=${variant.authProfile ?? "anonymous"}`,
        );
      }
    }
  }
}

function metricDelta(
  beforePath: string,
  afterPath: string,
): Record<string, number> {
  const before = JSON.parse(fs.readFileSync(beforePath, "utf8")) as Record<
    string,
    number
  >;
  const after = JSON.parse(fs.readFileSync(afterPath, "utf8")) as Record<
    string,
    number
  >;

  const delta: Record<string, number> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    delta[key] = (after[key] ?? 0) - (before[key] ?? 0);
  }
  return delta;
}

function run(command: string, args: string[], env?: Record<string, string>): void {
  execFileSync(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function walkForFile(filePath: string, fileName: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(filePath, { withFileTypes: true })) {
    const fullPath = path.join(filePath, entry.name);
    if (entry.isDirectory()) {
      walkForFile(fullPath, fileName, out);
      continue;
    }

    if (entry.isFile() && entry.name === fileName) {
      out.push(fullPath);
    }
  }

  return out;
}

function writeSuiteSummary(resultsRoot: string): void {
  const modeSummaryPaths = walkForFile(resultsRoot, "summary.json").sort();
  const modeSummaries = modeSummaryPaths.map((summaryPath) => {
    const modePath = path.dirname(summaryPath);
    const metricsDeltaPath = path.join(modePath, "metrics-delta.json");

    return extractComparableModeSummary({
      modePath,
      summaryDocument: readJsonFile<Record<string, unknown>>(summaryPath),
      metricsDeltaDocument: readJsonFile<Record<string, number>>(metricsDeltaPath),
    });
  });

  const suiteSummary = buildSuiteSummary({
    resultsRoot,
    modeSummaries,
  });

  fs.writeFileSync(
    path.join(resultsRoot, "suite-summary.json"),
    `${JSON.stringify(suiteSummary, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(resultsRoot, "suite-summary.md"),
    renderSuiteSummaryMarkdown(suiteSummary),
    "utf8",
  );
}

function buildK6Payload(input: {
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
  headers: Record<string, string>;
  expectedBody: unknown;
  stages: ReturnType<typeof buildK6Stages>;
}): string {
  return JSON.stringify({
    url: "http://127.0.0.1:3002/graphql",
    operationName: input.operationName,
    query: input.query,
    variables: input.variables,
    headers: input.headers,
    expectedBody: input.expectedBody,
    options: {
      stages: input.stages,
    },
  });
}

async function warmupScenarioVariant(input: {
  scenarioName: string;
  query: string;
  mode: Parameters<typeof resolveHeaders>[1];
  authProfile?: Parameters<typeof resolveHeaders>[2];
  fixturePath: string;
  cachePrefix: string;
  warmupRequests: number;
}): Promise<void> {
  const scenario = resolveScenario(input.scenarioName);
  const expected = JSON.stringify(
    normalizeResponseForComparison(readFixture(input.fixturePath)),
  );

  for (let index = 0; index < input.warmupRequests; index += 1) {
    const live = await runGraphQLRequest({
      scenario,
      query: input.query,
      authProfile: input.authProfile,
      headers: resolveHeaders(
        scenario,
        input.mode,
        input.authProfile,
        input.cachePrefix,
      ),
    });

    if (JSON.stringify(normalizeResponseForComparison(live)) !== expected) {
      throw new Error(
        `warmup mismatch for ${scenario.name} mode=${input.mode} auth=${input.authProfile ?? "anonymous"} request=${index + 1}`,
      );
    }
  }
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function createModeSummary(input: {
  scenarioName: string;
  mode: string;
  authProfile?: string;
  cachePrefix: string;
  operationName: string;
  fixturePath: string;
  warmupRequests: number;
  k6SummaryPath: string;
  pprofDir: string;
  stageConfig: ReturnType<typeof buildK6Stages>;
  modeDir: string;
}): Record<string, unknown> {
  const redisInfoAfterPath = path.join(input.modeDir, "redis-info-after.txt");
  const redisDockerAfterPath = path.join(
    input.modeDir,
    "redis-docker-stats-after.json",
  );

  return {
    scenario: input.scenarioName,
    mode: input.mode,
    authProfile: input.authProfile ?? null,
    cachePrefix: input.cachePrefix,
    operationName: input.operationName,
    fixturePath: input.fixturePath,
    warmup: {
      requests: input.warmupRequests,
    },
    k6: {
      summaryPath: input.k6SummaryPath,
      stages: input.stageConfig,
      summary: readJsonFile<Record<string, unknown>>(input.k6SummaryPath),
    },
    redis: {
      container:
        process.env.BENCHMARK_REDIS_CONTAINER ?? "cosmo-benchmark-redis",
      port: process.env.BENCHMARK_REDIS_PORT ?? "6399",
      image: process.env.BENCHMARK_REDIS_IMAGE ?? "redis:7-alpine",
      infoAfter: parseRedisInfoSummary(
        fs.readFileSync(redisInfoAfterPath, "utf8"),
      ),
      dockerStatsAfter: parseDockerStatsSummary(
        fs.readFileSync(redisDockerAfterPath, "utf8"),
      ),
    },
    pprofDir: input.pprofDir,
  };
}

async function runModeVariant(input: {
  scenarioName: string;
  mode: Parameters<typeof resolveHeaders>[1];
  authProfile?: Parameters<typeof resolveHeaders>[2];
  fixturePath: string;
  scenarioRoot: string;
  vus: number;
  duration: string;
  rampUp: string;
  rampDown: string;
}): Promise<void> {
  const scenario = resolveScenario(input.scenarioName);
  const query = resolveScenarioQuery(scenario);
  const modeDir = path.join(
    input.scenarioRoot,
    input.authProfile ? `${input.mode}-${input.authProfile}` : input.mode,
  );
  const pprofDir = path.join(modeDir, "pprof");
  const summaryExport = path.join(modeDir, "k6-summary.json");
  const stageConfig = buildK6Stages({
    vus: input.vus,
    duration: input.duration,
    rampUp: input.rampUp,
    rampDown: input.rampDown,
  });
  const cachePrefix = `bench-${scenario.name}-${input.mode}-${input.authProfile ?? "anonymous"}-${Date.now()}`;
  const expectedBody = readFixture(input.fixturePath);
  const headers = resolveHeaders(
    scenario,
    input.mode,
    input.authProfile,
    cachePrefix,
  );

  fs.mkdirSync(pprofDir, { recursive: true });

  await warmupScenarioVariant({
    scenarioName: scenario.name,
    query,
    mode: input.mode,
    authProfile: input.authProfile,
    fixturePath: input.fixturePath,
    cachePrefix,
    warmupRequests: scenario.warmupRequests,
  });

  run("pnpm", [
    "dlx",
    "tsx",
    "benchmark/scripts/scrape_metrics.ts",
    "before",
    modeDir,
  ]);
  run("bash", ["benchmark/scripts/capture_redis_stats.sh", "before", modeDir]);

  const payload = buildK6Payload({
    operationName: scenario.operationName,
    query,
    variables: scenario.variables ?? {},
    headers,
    expectedBody,
    stages: stageConfig,
  });

  execFileSync(
    "k6",
    ["run", "--summary-export", summaryExport, "benchmark/k6/cache_demo.js"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        BENCHMARK_PAYLOAD: payload,
      },
    },
  );

  run("pnpm", [
    "dlx",
    "tsx",
    "benchmark/scripts/scrape_metrics.ts",
    "after",
    modeDir,
  ]);
  run("bash", ["benchmark/scripts/capture_redis_stats.sh", "after", modeDir]);
  run("bash", ["benchmark/scripts/capture_pprof.sh", pprofDir]);

  const delta = metricDelta(
    path.join(modeDir, "metrics-before.json"),
    path.join(modeDir, "metrics-after.json"),
  );
  fs.writeFileSync(
    path.join(modeDir, "metrics-delta.json"),
    `${JSON.stringify(delta, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(modeDir, "equivalence.json"),
    `${JSON.stringify(
      {
        verified: true,
        fixturePath: input.fixturePath,
        mode: input.mode,
        authProfile: input.authProfile ?? null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(modeDir, "summary.json"),
    `${JSON.stringify(
      createModeSummary({
        scenarioName: scenario.name,
        mode: input.mode,
        authProfile: input.authProfile,
        cachePrefix,
        operationName: scenario.operationName,
        fixturePath: input.fixturePath,
        warmupRequests: scenario.warmupRequests,
        k6SummaryPath: summaryExport,
        pprofDir,
        stageConfig,
        modeDir,
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function runScenarios(args: {
  scenarioNames: string[];
  vus: number;
  duration: string;
  rampUp: string;
  rampDown: string;
}): Promise<void> {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const resultsRoot = path.join(process.cwd(), "benchmark", "results", timestamp);
  console.log(`results root: ${resultsRoot}`);

  run("bash", ["benchmark/scripts/start_stack.sh"]);

  try {
    run("bash", ["benchmark/scripts/wait_ready.sh"]);

    for (const scenarioName of args.scenarioNames) {
      const scenario = resolveScenario(scenarioName);
      const scenarioRoot = path.join(resultsRoot, scenario.name);
      await verifyScenarioEquivalence(scenario.name);

      for (const variant of resolveRequestMatrix(scenario)) {
        for (const mode of scenario.equivalenceModes) {
          await runModeVariant({
            scenarioName: scenario.name,
            mode,
            authProfile: variant.authProfile,
            fixturePath: variant.fixturePath,
            scenarioRoot,
            vus: args.vus,
            duration: args.duration,
            rampUp: args.rampUp,
            rampDown: args.rampDown,
          });
        }
      }
    }

    writeSuiteSummary(resultsRoot);
  } finally {
    run("bash", ["benchmark/scripts/stop_stack.sh"]);
  }
}

// Only run the CLI entry when this module is executed directly. Importing it
// (e.g. from run_suite.test.ts) must not parse process.argv or exit.
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  // Compare resolved paths so symlinks / "tsx ./scripts/run_suite.ts" /
  // "tsx scripts/run_suite.ts" all match.
  try {
    return path.resolve(entry) === path.resolve(__filename);
  } catch {
    // __filename is undefined under ESM; fall back to URL comparison.
    return import.meta.url === new URL(entry, "file:").href;
  }
}

if (isMainModule()) {
  const subcommand = process.argv[2];

  if (subcommand === "validate") {
    validate();
  } else if (subcommand === "summarize") {
    const resultsRoot = process.argv[3];
    if (!resultsRoot) {
      console.error(
        "usage: pnpm dlx tsx benchmark/scripts/run_suite.ts summarize <results-root>",
      );
      process.exit(1);
    }
    writeSuiteSummary(path.resolve(resultsRoot));
  } else {
    let args: ReturnType<typeof parseArgs>;
    try {
      args = parseArgs();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      console.error(
        "usage: pnpm dlx tsx benchmark/scripts/run_suite.ts validate | --all | --scenario <name> [--vus <n>] [--duration <dur>] [--ramp-up <dur>] [--ramp-down <dur>]",
      );
      process.exit(1);
    }
    if (!args.all && !args.scenario) {
      console.error(
        "usage: pnpm dlx tsx benchmark/scripts/run_suite.ts validate | --all | --scenario <name> [--vus <n>] [--duration <dur>] [--ramp-up <dur>] [--ramp-down <dur>]",
      );
      process.exit(1);
    }

    runScenarios({
      scenarioNames: args.all
        ? loadManifest().scenarios.map((scenario) => scenario.name)
        : [args.scenario as string],
      vus: args.vus,
      duration: args.duration,
      rampUp: args.rampUp,
      rampDown: args.rampDown,
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  }
}
