import { beforeEach, afterEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { type PartialMessage } from '@bufbuild/protobuf';
import { Command } from 'commander';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { CheckSubgraphSchemaResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Client } from '../src/core/client/client.js';
import { config } from '../src/core/config.js';
import CheckSchema from '../src/commands/subgraph/commands/check.js';
import type { JsonOutputDescriptor } from '../src/handle-check-result.js';

vi.mock('../src/core/config.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/core/config.js')>();
  return { ...mod, config: { ...mod.config } };
});

function createMockTransport(response: PartialMessage<CheckSubgraphSchemaResponse>) {
  return createRouterTransport(({ service }) => {
    service(PlatformService, {
      checkSubgraphSchema: () => response,
      isGitHubAppInstalled: () => ({
        response: { code: EnumStatusCode.OK },
        isInstalled: false,
      }),
    });
  });
}

function setVcsConfig({ author = '', commitSha = '', branch = '' } = {}) {
  vi.mocked(config).checkAuthor = author;
  vi.mocked(config).checkCommitSha = commitSha;
  vi.mocked(config).checkBranch = branch;
}

function resetVcsConfig() {
  vi.mocked(config).checkAuthor = '';
  vi.mocked(config).checkCommitSha = '';
  vi.mocked(config).checkBranch = '';
}

async function runCheck(
  response: PartialMessage<CheckSubgraphSchemaResponse>,
  opts: { limit?: number | string; schema?: string | null; delete?: boolean; json?: boolean } = {},
): Promise<void> {
  const schema = 'schema' in opts ? opts.schema : 'test/fixtures/schema.graphql';
  const args = ['check', 'wg.orders'];
  if (schema !== null) {
    args.push('--schema', schema ?? 'test/fixtures/schema.graphql');
  }
  if (opts.delete) {
    args.push('--delete');
  }
  if (opts.limit !== undefined) {
    args.push('--limit', String(opts.limit));
  }
  if (opts.json) {
    args.push('--json');
  }

  const client: Client = {
    platform: createPromiseClient(PlatformService, createMockTransport(response)),
  };
  const program = new Command();
  program.addCommand(CheckSchema({ client }));
  await program.parseAsync(args, { from: 'user' });
}

function getJsonOutput(logSpy: MockInstance<typeof console.log>): JsonOutputDescriptor {
  const call = logSpy.mock.calls.find(([arg]) => {
    try {
      JSON.parse(String(arg));
      return true;
    } catch {
      return false;
    }
  });
  if (!call) {
    throw new Error('No JSON output found in console.log calls');
  }
  return JSON.parse(String(call[0]));
}

describe('stdout', () => {
  let logSpy: MockInstance<typeof console.log>;
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  let exitSpy: MockInstance<typeof process.exit>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
    process.exitCode = undefined;
    resetVcsConfig();
  });

  test('no changes logs no changes, no lint issues, and no graph pruning issues', async () => {
    await runCheck({ response: { code: EnumStatusCode.OK } });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected no changes.'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected no lint issues.'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected no graph pruning issues.'));
  });

  test('proposal match warning is logged before no-changes message', async () => {
    await runCheck({
      response: { code: EnumStatusCode.OK },
      proposalMatchMessage: 'Schema does not match approved proposal',
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Warning: Proposal match failed'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Schema does not match approved proposal'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected no changes.'));
  });

  test('no operations affected succeeds and logs message when no errors', async () => {
    await runCheck({
      response: { code: EnumStatusCode.OK },
      nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
      operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No operations were affected by this schema change.'));
    expect(process.exitCode).not.toBe(1);
  });

  test('no operations affected fails when composition errors are present', async () => {
    await expect(
      runCheck({
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
        compositionErrors: [
          { message: 'Composition failed', federatedGraphName: 'my-graph', namespace: 'default', featureFlag: '' },
        ],
      }),
    ).rejects.toThrow();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No operations were affected by this schema change.'));
  });

  test('all operations safe succeeds and logs safe operations count', async () => {
    await runCheck({
      response: { code: EnumStatusCode.OK },
      nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
      operationUsageStats: { totalOperations: 5, safeOperations: 5, firstSeenAt: '', lastSeenAt: '' },
      clientTrafficCheckSkipped: false,
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('5 operations were considered safe due to overrides.'));
    expect(process.exitCode).not.toBe(1);
  });

  test('breaking changes logs count and fails', async () => {
    await expect(
      runCheck({
        response: { code: EnumStatusCode.OK },
        breakingChanges: [{ changeType: 'FIELD_REMOVED', message: 'Field removed', isBreaking: true }],
        operationUsageStats: {
          totalOperations: 3,
          safeOperations: 0,
          firstSeenAt: '2024-01-01T00:00:00Z',
          lastSeenAt: '2024-01-02T00:00:00Z',
        },
      }),
    ).rejects.toThrow();

    expect(String(logSpy.mock.calls[1]?.[0])).toMatch(/Found .*1.* breaking changes\./);
  });

  test('breaking changes reports impacted and safe operation counts', async () => {
    await expect(
      runCheck({
        response: { code: EnumStatusCode.OK },
        breakingChanges: [{ changeType: 'FIELD_REMOVED', message: 'Field removed', isBreaking: true }],
        operationUsageStats: {
          totalOperations: 3,
          safeOperations: 1,
          firstSeenAt: '2024-01-01T00:00:00Z',
          lastSeenAt: '2024-01-02T00:00:00Z',
        },
      }),
    ).rejects.toThrow();

    expect(String(logSpy.mock.calls[1]?.[0])).toMatch(/2.*operations impacted\./);
    expect(String(logSpy.mock.calls[1]?.[0])).toMatch(/1.*operations marked safe due to overrides\./);
  });

  test('non-breaking changes succeeds and logs detected changes table', async () => {
    await runCheck({
      response: { code: EnumStatusCode.OK },
      nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'New field added', isBreaking: false }],
      operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected the following changes:'));
    expect(process.exitCode).not.toBe(1);
  });

  test('composition errors logs table and fails', async () => {
    await expect(
      runCheck({
        response: { code: EnumStatusCode.OK },
        compositionErrors: [
          { message: 'Type mismatch error', federatedGraphName: 'my-graph', namespace: 'default', featureFlag: '' },
        ],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
      }),
    ).rejects.toThrow();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected composition errors:'));
  });

  test('composition warnings logs table and succeeds', async () => {
    await runCheck({
      response: { code: EnumStatusCode.OK },
      nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
      compositionWarnings: [
        { message: 'Deprecation warning', federatedGraphName: 'my-graph', namespace: 'default', featureFlag: '' },
      ],
      operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected composition warnings:'));
    expect(process.exitCode).not.toBe(1);
  });

  test('lint errors logs table and fails', async () => {
    await expect(
      runCheck({
        response: { code: EnumStatusCode.OK },
        lintErrors: [
          {
            lintRuleType: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE',
            message: 'Field name should be camelCase',
            issueLocation: { line: 10, column: 1, endLine: 10, endColumn: 20 },
          },
        ],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
      }),
    ).rejects.toThrow();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected lint issues:'));
  });

  test('lint warnings logs table and succeeds', async () => {
    await runCheck({
      response: { code: EnumStatusCode.OK },
      lintWarnings: [
        {
          lintRuleType: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE',
          message: 'Consider using camelCase',
          issueLocation: { line: 5, column: 1, endLine: 5, endColumn: 10 },
        },
      ],
      operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected lint issues:'));
    expect(process.exitCode).not.toBe(1);
  });

  test('graph pruning errors logs table and fails', async () => {
    await expect(
      runCheck({
        response: { code: EnumStatusCode.OK },
        graphPruneErrors: [
          {
            graphPruningRuleType: 'UNUSED_FIELDS',
            federatedGraphName: 'my-graph',
            fieldPath: 'Query.deprecatedField',
            message: 'Field is unused',
            issueLocation: { line: 15, column: 1, endLine: 15, endColumn: 30 },
          },
        ],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
      }),
    ).rejects.toThrow();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected graph pruning issues:'));
  });

  test('graph pruning warnings logs table and succeeds', async () => {
    await runCheck({
      response: { code: EnumStatusCode.OK },
      graphPruneWarnings: [
        {
          graphPruningRuleType: 'UNUSED_FIELDS',
          federatedGraphName: 'my-graph',
          fieldPath: 'Query.deprecatedField',
          message: 'Field might be unused',
          issueLocation: { line: 20, column: 1, endLine: 20, endColumn: 25 },
        },
      ],
      operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected graph pruning issues:'));
    expect(process.exitCode).not.toBe(1);
  });

  test('linked traffic check failure fails the check', async () => {
    await expect(
      runCheck({
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
        isLinkedTrafficCheckFailed: true,
      }),
    ).rejects.toThrow();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('target subgraph check has failed'));
  });

  test('linked pruning check failure fails the check', async () => {
    await expect(
      runCheck({
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
        isLinkedPruningCheckFailed: true,
      }),
    ).rejects.toThrow();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('target subgraph check has failed'));
  });

  test('extension check error fails and includes error message in output', async () => {
    await expect(
      runCheck({
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
        checkExtensionErrorMessage: 'Extension validation failed',
      }),
    ).rejects.toThrow();

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Subgraph extension check failed with message: Extension validation failed'),
    );
  });

  test('row limit exceeded logs truncation warning', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
        counts: {
          breakingChanges: 0,
          nonBreakingChanges: 60,
          compositionErrors: 0,
          compositionWarnings: 0,
          lintErrors: 0,
          lintWarnings: 0,
          graphPruneErrors: 0,
          graphPruneWarnings: 0,
        },
      },
      { limit: 50 },
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Some results were truncated due to exceeding the limit of 50 rows.'),
    );
  });

  test('vcs context is constructed when vcs config fields are set', async () => {
    setVcsConfig({ author: 'test-author', commitSha: 'abc123', branch: 'main' });

    await runCheck({ response: { code: EnumStatusCode.OK } });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected no changes.'));
  });

  test('missing schema and delete flag logs error and exits', async () => {
    await expect(runCheck({ response: { code: EnumStatusCode.OK } }, { schema: null })).rejects.toThrow();

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("'--schema <path-to-schema>' or '--delete' not specified"),
    );
  });

  test('non-existent schema file logs error and exits', async () => {
    await expect(
      runCheck({ response: { code: EnumStatusCode.OK } }, { schema: 'test/fixtures/nonexistent.graphql' }),
    ).rejects.toThrow();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
  });

  test('delete flag sends check without schema', async () => {
    await runCheck({ response: { code: EnumStatusCode.OK } }, { schema: null, delete: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Detected no changes.'));
  });

  test('invalid limit logs error and exits', async () => {
    await expect(runCheck({ response: { code: EnumStatusCode.OK } }, { limit: 'abc' })).rejects.toThrow();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('limit must be a valid number'));
  });

  test('limit of zero logs error and exits', async () => {
    await expect(runCheck({ response: { code: EnumStatusCode.OK } }, { limit: 0 })).rejects.toThrow();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('limit must be a valid number'));
  });

  test('limit exceeding max value logs error and exits', async () => {
    await expect(runCheck({ response: { code: EnumStatusCode.OK } }, { limit: 10_001 })).rejects.toThrow();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('limit must be a valid number'));
  });

  test('ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL logs proposal match failed and sets exit code', async () => {
    await runCheck({
      response: { code: EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL },
      proposalMatchMessage: 'Schema does not match approved proposal',
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Error: Proposal match failed'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Schema does not match approved proposal'));
    expect(process.exitCode).toBe(1);
  });

  test('ERR_INVALID_SUBGRAPH_SCHEMA logs early failure message with details and exits', async () => {
    await expect(
      runCheck({
        response: { code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA, details: 'Syntax error in schema' },
      }),
    ).rejects.toThrow();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Check has failed early because the schema could not be built.'),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Syntax error in schema'));
  });

  test('default error status logs failed to perform check with details and exits', async () => {
    await expect(
      runCheck({
        response: { code: EnumStatusCode.ERR, details: 'Internal server error' },
      }),
    ).rejects.toThrow();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to perform the check operation.'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Internal server error'));
  });
});

describe('json output', () => {
  let logSpy: MockInstance<typeof console.log>;
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  let exitSpy: MockInstance<typeof process.exit>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
    process.exitCode = undefined;
    resetVcsConfig();
  });

  test('no changes outputs JSON with success status and proposals', async () => {
    await runCheck({ response: { code: EnumStatusCode.OK } }, { json: true });

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('success');
    expect(output.proposals?.success).toBe(true);
    expect(output.proposals?.message).toContain('no changes');
  });

  test('proposal match warning outputs JSON with proposals.success false', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        proposalMatchMessage: 'Schema does not match approved proposal',
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.proposals?.success).toBe(false);
    expect(output.proposals?.message).toBe('Schema does not match approved proposal');
  });

  test('no operations affected outputs JSON with success status and traffic info', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('success');
    expect(output.traffic?.success).toBe(true);
    expect(output.traffic?.isLinkedToTargetSubgraph).toBe(false);
  });

  test('all operations safe outputs JSON with success status', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
        operationUsageStats: { totalOperations: 5, safeOperations: 5, firstSeenAt: '', lastSeenAt: '' },
        clientTrafficCheckSkipped: false,
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('success');
    expect(output.traffic?.success).toBe(true);
  });

  test('breaking changes outputs JSON with error status and breaking changes array', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        breakingChanges: [{ changeType: 'FIELD_REMOVED', message: 'Field removed', isBreaking: true }],
        operationUsageStats: {
          totalOperations: 3,
          safeOperations: 0,
          firstSeenAt: '2024-01-01T00:00:00Z',
          lastSeenAt: '2024-01-02T00:00:00Z',
        },
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('error');
    expect(output.changes).toBeDefined();
    expect(Array.isArray(output.changes?.breaking)).toBe(true);
    expect(Array.isArray(output.changes?.nonBreaking)).toBe(true);
    expect(output.operationUsageStats).toBeDefined();
  });

  test('non-breaking changes outputs JSON with success status and nonBreaking changes', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'New field added', isBreaking: false }],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('success');
    expect(output.changes).toBeDefined();
    expect(Array.isArray(output.changes?.nonBreaking)).toBe(true);
  });

  test('composition errors outputs JSON with error status and composition.errors populated', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        compositionErrors: [
          { message: 'Type mismatch error', federatedGraphName: 'my-graph', namespace: 'default', featureFlag: '' },
        ],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('error');
    expect(output.composition?.success).toBe(false);
    expect(output.composition).toBeDefined();
    expect(Array.isArray(output.composition?.errors)).toBe(true);
    expect(Array.isArray(output.composition?.warnings)).toBe(true);
  });

  test('composition warnings outputs JSON with success status and composition.warnings populated', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
        compositionWarnings: [
          { message: 'Deprecation warning', federatedGraphName: 'my-graph', namespace: 'default', featureFlag: '' },
        ],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('success');
    expect(output.composition).toBeDefined();
    expect(Array.isArray(output.composition?.errors)).toBe(true);
    expect(Array.isArray(output.composition?.warnings)).toBe(true);
  });

  test('lint errors outputs JSON with error status and lint.errors populated', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        lintErrors: [
          {
            lintRuleType: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE',
            message: 'Field name should be camelCase',
            issueLocation: { line: 10, column: 1, endLine: 10, endColumn: 20 },
          },
        ],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('error');
    expect(output.lint?.success).toBe(false);
    expect(output.lint).toBeDefined();
    expect(Array.isArray(output.lint?.errors)).toBe(true);
    expect(Array.isArray(output.lint?.warnings)).toBe(true);
  });

  test('lint warnings outputs JSON with success status and lint.warnings populated', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        lintWarnings: [
          {
            lintRuleType: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE',
            message: 'Consider using camelCase',
            issueLocation: { line: 5, column: 1, endLine: 5, endColumn: 10 },
          },
        ],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('success');
    expect(output.lint).toBeDefined();
    expect(Array.isArray(output.lint?.errors)).toBe(true);
    expect(Array.isArray(output.lint?.warnings)).toBe(true);
  });

  test('graph pruning errors outputs JSON with error status and graphPrune errors', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        graphPruneErrors: [
          {
            graphPruningRuleType: 'UNUSED_FIELDS',
            federatedGraphName: 'my-graph',
            fieldPath: 'Query.deprecatedField',
            message: 'Field is unused',
            issueLocation: { line: 15, column: 1, endLine: 15, endColumn: 30 },
          },
        ],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('error');
    expect(output.graphPrune?.success).toBe(false);
    expect(Array.isArray(output.graphPrune?.errors)).toBe(true);
    expect(Array.isArray(output.graphPrune?.warnings)).toBe(true);
  });

  test('graph pruning warnings outputs JSON with success status', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        graphPruneWarnings: [
          {
            graphPruningRuleType: 'UNUSED_FIELDS',
            federatedGraphName: 'my-graph',
            fieldPath: 'Query.deprecatedField',
            message: 'Field might be unused',
            issueLocation: { line: 20, column: 1, endLine: 20, endColumn: 25 },
          },
        ],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('success');
    expect(output.graphPrune).toBeDefined();
    expect(Array.isArray(output.graphPrune?.errors)).toBe(true);
    expect(Array.isArray(output.graphPrune?.warnings)).toBe(true);
  });

  test('linked traffic check failure outputs JSON with traffic.isLinkedToTargetSubgraph true', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
        isLinkedTrafficCheckFailed: true,
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('error');
    expect(output.traffic?.isLinkedToTargetSubgraph).toBe(true);
    expect(output.traffic?.success).toBe(false);
  });

  test('linked pruning check failure outputs JSON with graphPrune.isLinkedToTargetSubgraph true', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
        isLinkedPruningCheckFailed: true,
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('error');
    expect(output.graphPrune?.isLinkedToTargetSubgraph).toBe(true);
    expect(output.graphPrune?.success).toBe(false);
  });

  test('extension check error outputs JSON with extensions.success false', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
        checkExtensionErrorMessage: 'Extension validation failed',
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('error');
    expect(output.extensions?.success).toBe(false);
  });

  test('row limit exceeded outputs JSON with exceededRowLimit true', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.OK },
        nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
        operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
        counts: {
          breakingChanges: 0,
          nonBreakingChanges: 60,
          compositionErrors: 0,
          compositionWarnings: 0,
          lintErrors: 0,
          lintWarnings: 0,
          graphPruneErrors: 0,
          graphPruneWarnings: 0,
        },
      },
      { json: true, limit: 50 },
    );

    const output = getJsonOutput(logSpy);
    expect(output.exceededRowLimit).toBe(true);
    expect(output.rowLimit).toBe(50);
  });

  test('ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL outputs JSON with error status and details', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL },
        proposalMatchMessage: 'Schema does not match approved proposal',
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('error');
    expect(output.message).toContain('Proposal match failed');
    expect(output.details).toBe('Schema does not match approved proposal');
  });

  test('ERR_INVALID_SUBGRAPH_SCHEMA outputs JSON with error status and details', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA, details: 'Syntax error in schema' },
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('error');
    expect(output.message).toContain('schema could not be built');
    expect(output.details).toBe('Syntax error in schema');
  });

  test('default error status outputs JSON with error status and details', async () => {
    await runCheck(
      {
        response: { code: EnumStatusCode.ERR, details: 'Internal server error' },
      },
      { json: true },
    );

    const output = getJsonOutput(logSpy);
    expect(output.status).toBe('error');
    expect(output.message).toContain('Failed to perform the check operation');
    expect(output.details).toBe('Internal server error');
  });
});
