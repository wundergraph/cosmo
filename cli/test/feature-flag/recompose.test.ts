import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { runRecompose } from './utils.js';

describe('feature-flag recompose', () => {
  let logSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  test('that recompose is successful with default namespace', async () => {
    await runRecompose({
      response: { code: EnumStatusCode.OK },
      compositionErrors: [],
      compositionWarnings: [],
      deploymentErrors: [],
    });

    expect(process.exitCode).toBeUndefined();
  });

  test('that recompose is successful with specific namespace', async () => {
    await runRecompose(
      {
        response: { code: EnumStatusCode.OK },
        compositionErrors: [],
        compositionWarnings: [],
        deploymentErrors: [],
      },
      { namespace: 'production' },
    );

    expect(process.exitCode).toBeUndefined();
  });

  test('that recompose fails with exit code 1 if response is missing', async () => {
    await runRecompose({});

    expect(process.exitCode).toBe(1);
  });

  test('that recompose fails fails with exit code 1 if config splitting is not enabled', async () => {
    await expect(
      runRecompose({
        response: { code: EnumStatusCode.ERR, details: 'Configuration splitting not enabled' },
        compositionErrors: [],
        compositionWarnings: [],
        deploymentErrors: [],
      }),
    ).rejects.toThrow();

    expect(process.exitCode).toBeUndefined();
  });

  test('that recompose fails but does not return exit code 1 if the feature flag is not found', async () => {
    await expect(
      runRecompose({
        response: { code: EnumStatusCode.ERR_NOT_FOUND, details: 'The feature flag "feature-flag" was not found' },
        compositionErrors: [],
        compositionWarnings: [],
        deploymentErrors: [],
      }),
    ).rejects.toThrow();

    expect(process.exitCode).toBeUndefined();
  });

  test('that recompose fails if composition errors occur but does not return exit code 1', async () => {
    await runRecompose({
      response: { code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED },
      compositionErrors: [{ federatedGraphName: 'mygraph', namespace: 'default', message: 'Composition failed' }],
      compositionWarnings: [],
      deploymentErrors: [],
    });

    expect(process.exitCode).toBeUndefined();
  });

  test('that recompose fails if composition errors occur and returns exit code 1 if --fail-on-composition-error is set', async () => {
    await runRecompose(
      {
        response: { code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED },
        compositionErrors: [{ federatedGraphName: 'mygraph', namespace: 'default', message: 'Composition failed' }],
        compositionWarnings: [],
        deploymentErrors: [],
      },
      { failOnCompositionError: true },
    );

    expect(process.exitCode).toBe(1);
  });

  test('that recompose fails if deployment errors occur but does not return exit code 1', async () => {
    await runRecompose({
      response: { code: EnumStatusCode.ERR_DEPLOYMENT_FAILED },
      compositionErrors: [],
      compositionWarnings: [],
      deploymentErrors: [{ federatedGraphName: 'mygraph', namespace: 'default', message: 'Deploy failed' }],
    });

    expect(process.exitCode).toBeUndefined();
  });

  test('that recompose fails if deployment errors occur and returns exit code 1 if --fail-on-admission-webhook-error is set', async () => {
    await runRecompose(
      {
        response: { code: EnumStatusCode.ERR_DEPLOYMENT_FAILED },
        compositionErrors: [],
        compositionWarnings: [],
        deploymentErrors: [{ federatedGraphName: 'mygraph', namespace: 'default', message: 'Deploy failed' }],
      },
      { failOnAdmissionWebhookError: true },
    );

    expect(process.exitCode).toBe(1);
  });

  test('that composition warnings are shown by default', async () => {
    await runRecompose({
      response: { code: EnumStatusCode.OK },
      compositionErrors: [],
      compositionWarnings: [{ federatedGraphName: 'mygraph', namespace: 'default', message: 'Some warning' }],
      deploymentErrors: [],
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('warnings were produced'));
  });

  test('suppresses composition warnings when --suppress-warnings is set', async () => {
    await runRecompose(
      {
        response: { code: EnumStatusCode.OK },
        compositionErrors: [],
        compositionWarnings: [{ federatedGraphName: 'mygraph', namespace: 'default', message: 'Some warning' }],
        deploymentErrors: [],
      },
      { suppressWarnings: true },
    );

    const warningCalls = logSpy.mock.calls.filter(
      ([arg]) => typeof arg === 'string' && arg.includes('warnings were produced'),
    );
    expect(warningCalls).toHaveLength(0);
  });
});
