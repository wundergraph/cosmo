import fs from "node:fs";
import path from "node:path";

const ALLOWLIST = [
  "go_memstats_",
  "go_gc_duration_seconds",
  "go_goroutines",
  "process_cpu_seconds_total",
  "process_resident_memory_bytes",
  "router_entity_cache_requests_stats_total",
  "router_entity_cache_keys_stats_total",
  "router_entity_cache_populations_total",
  "router_entity_cache_latency",
  "router_graphql_operation_planning_time",
];

function keepMetric(line: string): boolean {
  return ALLOWLIST.some((prefix) => line.startsWith(prefix));
}

function parseMetrics(raw: string): Record<string, number> {
  const parsed: Record<string, number> = {};

  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("#") || !keepMetric(line)) {
      continue;
    }

    const match = line.match(/^([^{\s]+)(\{[^}]*\})?\s+([0-9.eE+-]+)$/);
    if (!match) {
      continue;
    }

    const [, name, labels = "", value] = match;
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      parsed[`${name}${labels}`] = numeric;
    }
  }

  return parsed;
}

async function main(): Promise<void> {
  const phase = process.argv[2];
  const outputDir = process.argv[3];

  if (!phase || !outputDir) {
    throw new Error(
      "usage: pnpm dlx tsx benchmark/scripts/scrape_metrics.ts <phase> <output-dir>",
    );
  }

  const response = await fetch("http://127.0.0.1:8088/metrics");
  if (!response.ok) {
    throw new Error(`failed to fetch router metrics: ${response.status}`);
  }

  const raw = await response.text();
  const parsed = parseMetrics(raw);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, `metrics-${phase}.prom`), raw, "utf8");
  fs.writeFileSync(
    path.join(outputDir, `metrics-${phase}.json`),
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf8",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
