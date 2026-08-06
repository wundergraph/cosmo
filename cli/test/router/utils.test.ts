import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { beforeAll, describe, expect, test } from 'vitest';
import { writeFeatureFlagConfigToFile, featureFlagsDir } from '../../src/commands/router/utils.js';

describe('writeFeatureFlagConfigToFile', () => {
  const basePath = join(tmpdir(), featureFlagsDir);
  beforeAll(async () => {
    if (existsSync(basePath)) {
      // Cleanup existing data, if any
      await rm(basePath, { recursive: true });
    }

    await mkdir(basePath, { recursive: true });
  });

  test('that when no special characters are found, it is written to the base path', async () => {
    const name = 'feature-flag';

    expect(existsSync(join(basePath, `${name}.json`))).toBe(false);
    await writeFeatureFlagConfigToFile(basePath, name, '');
    expect(existsSync(join(basePath, `${name}.json`))).toBe(true);
  });

  test.each(['feature/name', 'feature.name', 'feature/../name', '../name'])(
    'that it throws when name contains invalid characters',
    async (name) => {
      expect(existsSync(join(basePath, `${name}.json`))).toBe(false);
      await expect(async () => await writeFeatureFlagConfigToFile(basePath, name, '')).rejects.toThrowError(
        `The feature flag name "${name}" contains invalid characters.`,
      );
      expect(existsSync(join(basePath, `${name}.json`))).toBe(false);
    },
  );
});
