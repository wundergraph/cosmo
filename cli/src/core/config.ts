import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import yaml from 'js-yaml';
import envPaths from 'env-paths';

import info from '../../package.json' with { type: 'json' };
import { deployment } from './deployment.js';

const paths = envPaths('cosmo', { suffix: '' });
export const configDir = paths.config;
export const dataDir = paths.data;
export const cacheDir = paths.cache;
export const configFile = join(configDir, 'config.yaml');

export const getLoginDetails = (): { accessToken: string; organizationSlug: string } | null => {
  try {
    const data = yaml.load(readFileSync(configFile, 'utf8'));
    const loginData = JSON.parse(JSON.stringify(data));
    return { accessToken: loginData.accessToken, organizationSlug: loginData.organizationSlug };
  } catch {
    return null;
  }
};

export const config = {
  version: info.version,
  baseURL: process.env.COSMO_API_URL || deployment.cosmoApiUrl,
  // environment var first to allow overriding
  apiKey: process.env.COSMO_API_KEY,
  kcApiURL: process.env.KC_API_URL || deployment.keycloakUrl,
  webURL: process.env.COSMO_WEB_URL || deployment.cosmoWebUrl,
  kcClientId: process.env.KC_CLIENT_ID || 'cosmo-cli',
  kcRealm: process.env.KC_REALM || 'cosmo',
  hubURL: process.env.HUB_URL || deployment.hubUrl,
  hubAppURL: process.env.HUB_APP_URL || deployment.hubAppUrl,
  hubOidcAudience: process.env.HUB_OIDC_AUDIENCE || 'hub',
  cdnURL: process.env.CDN_URL || deployment.cdnUrl,
  // npm's latest wgc talks to Cosmo Cloud, so a Hub deployment's wgc never suggests it.
  disableUpdateCheck: process.env.DISABLE_UPDATE_CHECK || (deployment.kind === 'hub' ? 'true' : 'false'),
  checkAuthor: process.env.COSMO_VCS_AUTHOR || '',
  checkCommitSha: process.env.COSMO_VCS_COMMIT || '',
  checkBranch: process.env.COSMO_VCS_BRANCH || '',
  pluginRegistryURL:
    process.env.PLUGIN_REGISTRY_URL || (deployment.kind === 'cosmo-cloud' ? deployment.pluginRegistryHost : undefined),
  /** What `npm install` takes to install this wgc. */
  wgcInstallArgs: deployment.kind === 'hub' ? `--allow-remote=all ${deployment.cliPackagesUrl}/wgc.tgz` : 'wgc@latest',
  pluginRegistryInsecure: process.env.PLUGIN_REGISTRY_INSECURE === 'true',
  demoLabelMatcher: 'graph=demo' as const,
  demoGraphName: 'demo' as const,
  demoNamespace: 'default' as const,
  demoOnboardingRepositoryName: 'wundergraph/cosmo-onboarding' as const,
  demoOnboardingRepositoryBranch: 'main' as const,
  dockerBuilderName: 'cosmo-builder' as const,
  defaultTelemetryEndpoint: process.env.DEFAULT_TELEMETRY_ENDPOINT,
  graphqlMetricsCollectorEndpoint: process.env.GRAPHQL_METRICS_COLLECTOR_ENDPOINT,
  demoRouterPort: 3002 as const,
  demoPluginNames: ['products', 'reviews'] as const,
  demoRouterTokenName: 'demo-router-token' as const,
  demoRouterImage: 'ghcr.io/wundergraph/cosmo/router:latest' as const,
  demoRouterContainerName: 'cosmo-demo-router' as const,
};

export const getBaseHeaders = (): HeadersInit => {
  return {
    'user-agent': `cosmo-cli/${info.version}`,
    authorization: 'Bearer ' + config.apiKey,
    'cosmo-org-slug': getLoginDetails()?.organizationSlug || '',
  };
};
