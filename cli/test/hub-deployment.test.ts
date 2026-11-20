import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Deployment } from '../src/core/deployment.js';

const hubDeployment: Deployment = {
  kind: 'hub',
  cosmoApiUrl: 'https://cosmo.poc.example',
  cosmoWebUrl: 'https://studio.poc.example',
  hubUrl: 'https://hub.poc.example',
  hubAppUrl: 'https://hub-app.poc.example',
  cdnUrl: 'https://cdn.poc.example',
  keycloakUrl: 'https://hub.poc.example',
  cliPackagesUrl: 'https://hub.poc.example/cli',
};

const posthogCreated = vi.fn();

vi.mock('../src/core/deployment.js', () => ({ deployment: hubDeployment }));
vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor() {
      posthogCreated();
    }

    on() {}
  },
}));

describe('wgc packed for a Hub deployment', () => {
  beforeEach(() => {
    vi.resetModules();
    posthogCreated.mockClear();
    for (const name of [
      'COSMO_API_URL',
      'COSMO_WEB_URL',
      'HUB_URL',
      'HUB_APP_URL',
      'CDN_URL',
      'KC_API_URL',
      'PLUGIN_REGISTRY_URL',
      'DISABLE_UPDATE_CHECK',
      'DO_NOT_TRACK',
      'COSMO_TELEMETRY_ENABLED',
    ]) {
      vi.stubEnv(name, '');
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('talks to the deployment, installs from it and has no plugin registry', async () => {
    const { config } = await import('../src/core/config.js');
    const { defaultPluginEnvironment } = await import('../src/core/plugins/environment.js');

    expect({
      baseURL: config.baseURL,
      webURL: config.webURL,
      hubURL: config.hubURL,
      hubAppURL: config.hubAppURL,
      cdnURL: config.cdnURL,
      kcApiURL: config.kcApiURL,
      kcRealm: config.kcRealm,
      kcClientId: config.kcClientId,
      pluginRegistryURL: config.pluginRegistryURL,
      disableUpdateCheck: config.disableUpdateCheck,
      wgcInstallArgs: config.wgcInstallArgs,
      pluginPackagesUrl: defaultPluginEnvironment({}).registryUrl,
    }).toEqual({
      baseURL: 'https://cosmo.poc.example',
      webURL: 'https://studio.poc.example',
      hubURL: 'https://hub.poc.example',
      hubAppURL: 'https://hub-app.poc.example',
      cdnURL: 'https://cdn.poc.example',
      kcApiURL: 'https://hub.poc.example',
      kcRealm: 'cosmo',
      kcClientId: 'cosmo-cli',
      pluginRegistryURL: undefined,
      disableUpdateCheck: 'true',
      wgcInstallArgs: '--allow-remote=all https://hub.poc.example/cli/wgc.tgz',
      pluginPackagesUrl: 'https://hub.poc.example/cli',
    });
  });

  test('environment variables still win over the baked hosts', async () => {
    vi.stubEnv('COSMO_API_URL', 'http://localhost:3001');
    vi.stubEnv('PLUGIN_REGISTRY_URL', 'localhost:5000');
    vi.stubEnv('HUB_URL', 'http://localhost:3405');
    vi.stubEnv('HUB_APP_URL', 'http://localhost:3400');
    const { config } = await import('../src/core/config.js');
    const { defaultPluginEnvironment } = await import('../src/core/plugins/environment.js');

    expect(config.baseURL).toBe('http://localhost:3001');
    expect(config.hubURL).toBe('http://localhost:3405');
    expect(config.hubAppURL).toBe('http://localhost:3400');
    expect(config.pluginRegistryURL).toBe('localhost:5000');
    expect(defaultPluginEnvironment({ WGC_PLUGIN_REGISTRY_URL: 'http://127.0.0.1:8099' }).registryUrl).toBe(
      'http://127.0.0.1:8099',
    );
  });

  test('sends no telemetry unless COSMO_TELEMETRY_ENABLED turns it on', async () => {
    const off = await import('../src/core/telemetry.js');
    off.initTelemetry();
    expect(posthogCreated).not.toHaveBeenCalled();

    vi.resetModules();
    vi.stubEnv('COSMO_TELEMETRY_ENABLED', 'true');
    const on = await import('../src/core/telemetry.js');
    on.initTelemetry();
    expect(posthogCreated).toHaveBeenCalledTimes(1);
  });
});

describe('the hosts pack-for-hub.sh bakes in', () => {
  test('the local install calls Hub on its API port and links to its web app port', async () => {
    const { hubDeployment } =
      await vi.importActual<typeof import('../src/core/deployment.js')>('../src/core/deployment.js');

    expect(hubDeployment('localhost')).toEqual({
      kind: 'hub',
      cosmoApiUrl: 'http://localhost:4431',
      cosmoWebUrl: 'http://localhost:4430',
      hubUrl: 'http://localhost:4405',
      hubAppUrl: 'http://localhost:4400',
      cdnUrl: 'http://localhost:4487',
      keycloakUrl: 'http://localhost:4480',
      cliPackagesUrl: 'http://localhost:4405/cli',
    });
  });

  test('a deployment on a base domain serves Hub API and web app from hub.<base>', async () => {
    const { hubDeployment } =
      await vi.importActual<typeof import('../src/core/deployment.js')>('../src/core/deployment.js');

    expect(hubDeployment('moonshot.wundergraph.com')).toEqual({
      kind: 'hub',
      cosmoApiUrl: 'https://cosmo.moonshot.wundergraph.com',
      cosmoWebUrl: 'https://studio.moonshot.wundergraph.com',
      hubUrl: 'https://hub.moonshot.wundergraph.com',
      hubAppUrl: 'https://hub.moonshot.wundergraph.com',
      cdnUrl: 'https://cdn.moonshot.wundergraph.com',
      keycloakUrl: 'https://hub.moonshot.wundergraph.com',
      cliPackagesUrl: 'https://hub.moonshot.wundergraph.com/cli',
    });
  });
});
