import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
    const uniqueName = randomUUID();

    expect(existsSync(join(basePath, `${uniqueName}.json`))).toBe(false);
    await writeFeatureFlagConfigToFile(basePath, uniqueName, '');
    expect(existsSync(join(basePath, `${uniqueName}.json`))).toBe(true);
  });

  test('that when a name starts with slash, it is written to the base path', async () => {
    const uniqueName = randomUUID();

    expect(existsSync(join(basePath, `${uniqueName}.json`))).toBe(false);
    await writeFeatureFlagConfigToFile(basePath, `/${uniqueName}`, '');
    expect(existsSync(join(basePath, `${uniqueName}.json`))).toBe(true);
  });

  test('that when `..` is found in the name, the file does not escape the base path', async () => {
    const uniqueName = randomUUID();
    const name = `../../../../${uniqueName}`;

    expect(existsSync(join(basePath, `${uniqueName}.json`))).toBe(false);
    await writeFeatureFlagConfigToFile(basePath, name, '');
    expect(existsSync(join(basePath, `${uniqueName}.json`))).toBe(true);
  });

  test('that a name with special characters does not escape the base path', async () => {
    const uniqueName = randomUUID();
    const name = `feature/../../flag/${uniqueName}`;

    expect(existsSync(join(basePath, 'flag', `${uniqueName}.json`))).toBe(false);
    await writeFeatureFlagConfigToFile(basePath, name, '');
    expect(existsSync(join(basePath, 'flag', `${uniqueName}.json`))).toBe(true);
  });
});
