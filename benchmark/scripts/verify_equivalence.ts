import process from "node:process";

import {
  normalizeResponseForComparison,
  readFixture,
  resolveHeaders,
  resolveRequestMatrix,
  resolveScenario,
  resolveScenarioQuery,
  runGraphQLRequest,
  type Mode,
} from "./lib";

async function main(): Promise<void> {
  const scenarioName = process.argv[2];

  if (!scenarioName) {
    throw new Error("usage: pnpm dlx tsx benchmark/scripts/verify_equivalence.ts <scenario>");
  }

  const scenario = resolveScenario(scenarioName);
  const query = resolveScenarioQuery(scenario);

  for (const variant of resolveRequestMatrix(scenario)) {
    const fixture = normalizeResponseForComparison(readFixture(variant.fixturePath));

    for (const mode of scenario.equivalenceModes as Mode[]) {
      const live = normalizeResponseForComparison(
        await runGraphQLRequest({
          scenario,
          query,
          authProfile: variant.authProfile,
          headers: resolveHeaders(
            scenario,
            mode,
            variant.authProfile,
            `eq-${scenario.name}-${mode}-${Date.now()}`,
          ),
        }),
      );

      const expected = JSON.stringify(fixture);
      const actual = JSON.stringify(live);

      if (expected !== actual) {
        throw new Error(
          `fixture mismatch for scenario=${scenario.name} auth=${variant.authProfile ?? "anonymous"} mode=${mode}`,
        );
      }

      console.log(
        `verified scenario=${scenario.name} auth=${variant.authProfile ?? "anonymous"} mode=${mode}`,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
