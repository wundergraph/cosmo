import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { hubResults, hubTools } from '../src/common/contract.js';

describe('the contract with Hub', () => {
  test('contract/reads.json is what the commands read from each Hub tool', async () => {
    const reads = Object.fromEntries(
      Object.entries(hubTools).map(([command, tool]) => [
        tool,
        z.toJSONSchema(hubResults[command as keyof typeof hubTools], { io: 'input' }),
      ]),
    );

    await expect(`${JSON.stringify(reads, null, 2)}\n`).toMatchFileSnapshot('../contract/reads.json');
  });
});
