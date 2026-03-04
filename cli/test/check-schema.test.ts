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
  opts: { limit?: number | string; schema?: string | null; delete?: boolean } = {},
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

  const client: Client = {
    platform: createPromiseClient(PlatformService, createMockTransport(response)),
  };
  const program = new Command();
  program.addCommand(CheckSchema({ client }));
  await program.parseAsync(args, { from: 'user' });
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

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Found 1 breaking changes.'));
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

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('2 operations impacted.'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 operations marked safe due to overrides.'));
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
