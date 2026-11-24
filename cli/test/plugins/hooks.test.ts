import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import {
  CheckSubgraphSchemaResponseSchema,
  IsGitHubAppInstalledResponseSchema,
  PlatformService,
  type CheckSubgraphSchemaResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { AfterHookEvent, HookContribution } from '@wundergraph/wgc-plugin-sdk';
import { attachPlugins } from '../../src/core/plugins/startup.js';
import { commandHooks, createCommandHookRegistry } from '../../src/core/plugins/hooks.js';
import CheckSchema from '../../src/commands/subgraph/commands/check.js';
import { createMemoryStream, createTempDir, createTestContext, fixturesDir } from './utils.js';

/** A managed install of the fixture packages, each under the command name it claims. */
const installed = (plugins: Record<string, string>) => {
  const managedDir = createTempDir();
  mkdirSync(join(managedDir, 'node_modules'), { recursive: true });
  for (const packageName of Object.values(plugins)) {
    cpSync(join(fixturesDir, packageName), join(managedDir, 'node_modules', packageName), { recursive: true });
  }
  writeFileSync(join(managedDir, 'plugins.json'), JSON.stringify({ plugins }));
  return { managedDir, workspaceRoot: undefined, runsFromSource: false, registryUrl: undefined };
};

const cosmoProgram = () => {
  const program = new Command('wgc');
  program.exitOverride();
  program.command('subgraph').command('check');
  program.command('auth');
  return program;
};

describe('attachPlugins for a hookable core command', () => {
  test('loads an installed third-party plugin so its hooks run on subgraph check', async () => {
    const environment = installed({ gate: 'wgc-plugin-gate', echo: 'wgc-plugin-echo' });
    const hooks = createCommandHookRegistry();

    await attachPlugins({
      program: cosmoProgram(),
      argv: ['node', 'wgc', 'subgraph', 'check', 'frozen', '--schema', 'a.graphql'],
      environment,
      createContext: () => createTestContext('human', createMemoryStream(), createMemoryStream()),
      hooks,
    });
    const outcome = await hooks.runAfter(
      'subgraph check',
      { subgraph: 'frozen', namespace: 'default', schemaPath: 'a.graphql', delete: false },
      { passed: true, checkUrl: undefined, problems: [] },
    );

    expect(outcome).toEqual({
      failed: true,
      verdicts: [{ plugin: 'gate', contribution: { verdict: 'failed', summary: 'frozen in default: Cosmo passed' } }],
    });
  });

  test('loads no plugin for a core command nothing can hook', async () => {
    const environment = installed({ gate: 'wgc-plugin-gate' });
    const hooks = createCommandHookRegistry();

    await attachPlugins({
      program: cosmoProgram(),
      argv: ['node', 'wgc', 'auth', 'whoami'],
      environment,
      createContext: () => createTestContext('human', createMemoryStream(), createMemoryStream()),
      hooks,
    });
    const outcome = await hooks.runAfter(
      'subgraph check',
      { subgraph: 'frozen', namespace: 'default', schemaPath: 'a.graphql', delete: false },
      { passed: true, checkUrl: undefined, problems: [] },
    );

    expect(outcome).toEqual({ failed: false, verdicts: [] });
  });

  test('a plugin that fails to load is skipped with a warning', async () => {
    const environment = installed({ broken: 'wgc-plugin-broken', gate: 'wgc-plugin-gate' });
    const warnings: string[] = [];

    await attachPlugins({
      program: cosmoProgram(),
      argv: ['node', 'wgc', 'subgraph', 'check', 'products', '--schema', 'a.graphql'],
      environment,
      createContext: () => createTestContext('human', createMemoryStream(), createMemoryStream()),
      hooks: createCommandHookRegistry(),
      warn: (message) => warnings.push(message),
    });

    expect(warnings).toEqual([expect.stringMatching(/^The broken plugin did not load, so its hooks did not run: /)]);
  });
});

const runCheck = async (response: CheckSubgraphSchemaResponse, extra: string[] = []) => {
  const transport = createRouterTransport(({ service }) => {
    service(PlatformService, {
      checkSubgraphSchema: () => response,
      isGitHubAppInstalled: () =>
        create(IsGitHubAppInstalledResponseSchema, { response: { code: EnumStatusCode.OK }, isInstalled: false }),
    });
  });
  const program = new Command();
  program.addCommand(CheckSchema({ client: { platform: createClient(PlatformService, transport) } }));
  await program.parseAsync(
    ['check', 'products', '--namespace', 'staging', '--schema', 'test/fixtures/schema.graphql', ...extra],
    { from: 'user' },
  );
};

const cosmoPassed = create(CheckSubgraphSchemaResponseSchema, {
  response: { code: EnumStatusCode.OK },
  checkId: 'c1',
  checkedFederatedGraphs: [{ name: 'shop', namespace: 'staging', organizationSlug: 'acme' }],
  nonBreakingChanges: [{ changeType: 'FIELD_ADDED', message: 'Field added', isBreaking: false }],
  operationUsageStats: { totalOperations: 0, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
});

const cosmoFailed = create(CheckSubgraphSchemaResponseSchema, {
  response: { code: EnumStatusCode.OK },
  breakingChanges: [{ changeType: 'FIELD_REMOVED', message: 'Field "Query.a" was removed', isBreaking: true }],
  operationUsageStats: { totalOperations: 3, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
});

describe('wgc subgraph check with a plugin hooking it', () => {
  let logSpy: MockInstance<typeof console.log>;
  let stderr: string;
  const seen: Array<AfterHookEvent<'subgraph check'>> = [];

  const hook = (contribution: HookContribution) => {
    commandHooks
      .forPlugin('hub', createTestContext('human', createMemoryStream(), createMemoryStream()))
      .after('subgraph check', (event) => {
        seen.push(event);
        return Promise.resolve(contribution);
      });
  };

  beforeEach(() => {
    stderr = '';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    commandHooks.clear();
    seen.length = 0;
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  const printed = () => logSpy.mock.calls.map(([line]) => String(line)).join('\n');

  test('hands the hook Cosmo’s verdict and passes when both pass', async () => {
    hook({ verdict: 'passed', summary: 'sandbox pr-shop-12 is up to date', url: 'https://hub.example/pr-shop-12' });

    await runCheck(cosmoPassed);

    expect(seen.map(({ input, result }) => ({ input, result }))).toEqual([
      {
        input: { subgraph: 'products', namespace: 'staging', schemaPath: expect.stringMatching(/schema\.graphql$/), delete: false },
        result: { passed: true, checkUrl: expect.stringMatching(/\/acme\/staging\/graph\/shop\/checks\/c1$/), problems: [] },
      },
    ]);
    expect(printed()).toContain('hub: sandbox pr-shop-12 is up to date\n  https://hub.example/pr-shop-12');
    expect(printed()).toContain('Schema check passed.');
    expect(process.exitCode).not.toBe(1);
  });

  test('fails the one verdict when Cosmo passes but the plugin fails', async () => {
    hook({ verdict: 'failed', summary: '1 of 3 operations failed in sandbox pr-shop-12' });

    await expect(runCheck(cosmoPassed)).rejects.toThrow('process.exit');

    expect(printed()).not.toContain('Schema check passed.');
    expect(stderr).toContain(
      "Schema check failed. Cosmo's check passed, but hub: 1 of 3 operations failed in sandbox pr-shop-12",
    );
  });

  test('a failed Cosmo check still reaches the hook with its problems', async () => {
    hook({ verdict: 'passed', summary: 'sandbox pr-shop-12 is up to date' });

    await expect(runCheck(cosmoFailed)).rejects.toThrow('process.exit');

    expect(seen.map(({ result }) => result)).toEqual([
      { passed: false, checkUrl: undefined, problems: ['breaking change: Field "Query.a" was removed'] },
    ]);
    expect(printed()).toContain('hub: sandbox pr-shop-12 is up to date');
  });

  test('JSON output carries the plugin under plugins and the combined status', async () => {
    hook({ verdict: 'failed', summary: 'collections failed', data: { failed: 1 } });

    await runCheck(cosmoPassed, ['--json']);

    const json = JSON.parse(printed());
    expect(json.status).toBe('error');
    expect(json.plugins).toEqual({
      hub: { verdict: 'failed', summary: 'collections failed', details: [], url: null, data: { failed: 1 } },
    });
    expect(process.exitCode).toBe(1);
  });

  test('without plugins the output is Cosmo’s alone', async () => {
    await runCheck(cosmoPassed, ['--json']);

    const json = JSON.parse(printed());
    expect(json.status).toBe('success');
    expect(json.plugins).toBeUndefined();
  });
});
