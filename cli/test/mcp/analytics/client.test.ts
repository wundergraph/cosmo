import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ANALYTICS_READ_RPCS, createReadOnlyAnalyticsClient } from '../../../src/commands/mcp/analytics/client.js';

const analyticsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../src/commands/mcp/analytics');

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

describe('analytics read-only client', () => {
  test('exposes exactly the allow-listed read RPCs', () => {
    const platform = createClient(
      PlatformService,
      createRouterTransport(() => {}),
    );

    const client = createReadOnlyAnalyticsClient(platform);

    expect(Object.keys(client).sort()).toEqual([...ANALYTICS_READ_RPCS].sort());
  });

  test('no analytics file reaches the full platform client', () => {
    const offenders = filesUnder(analyticsDir).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes('.platform.') || source.includes('opts.client');
    });

    expect(offenders).toEqual([]);
  });
});
