import { InvalidArgumentError } from 'commander';
import { describe, expect, test } from 'vitest';
import createMcpCommand, { parseToolsets } from '../../src/commands/mcp/index.js';
import type { BaseCommandOptions } from '../../src/core/types/types.js';

describe('wgc mcp --toolsets', () => {
  test('rejects a toolset it does not know', async () => {
    const command = createMcpCommand({} as BaseCommandOptions)
      .exitOverride()
      .configureOutput({ writeErr: () => {} });

    const error = await command.parseAsync(['--toolsets', 'schema,analytic'], { from: 'user' }).catch((e: Error) => e);

    expect((error as Error).message).toBe(
      "error: option '--toolsets <list>' argument 'schema,analytic' is invalid. Use a comma-separated list of: schema, analytics.",
    );
  });

  test('reads a comma-separated list, ignoring spaces', () => {
    expect([...parseToolsets(' analytics , schema ')]).toEqual(['analytics', 'schema']);
  });

  test('rejects an empty list', () => {
    expect(() => parseToolsets(' , ')).toThrow(
      new InvalidArgumentError('Use a comma-separated list of: schema, analytics.'),
    );
  });
});
