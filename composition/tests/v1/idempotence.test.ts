import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { federateSubgraphs, parse, printSortedSdl, type Subgraph } from '../../src';

type ScenarioManifest = {
  subgraphs: Array<{
    file: string;
    name: string;
    url?: string;
  }>;
};

describe('federation idempotence', () => {
  test('federates the benchmark scenario twice from the same parsed documents', () => {
    const scenarioDir = join(process.cwd(), 'bench', 'scenario');
    const manifest = JSON.parse(readFileSync(join(scenarioDir, 'manifest.json'), 'utf8')) as ScenarioManifest;
    const subgraphs: Subgraph[] = manifest.subgraphs.map((subgraph) => ({
      definitions: parse(readFileSync(join(scenarioDir, subgraph.file), 'utf8')),
      name: subgraph.name,
      url: subgraph.url ?? '',
    }));

    const first = federateSubgraphs({ subgraphs });
    const second = federateSubgraphs({ subgraphs });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (!first.success || !second.success) {
      return;
    }

    expect(printSortedSdl(second.federatedGraphAST)).toBe(printSortedSdl(first.federatedGraphAST));
  });
});
