import crypto from 'node:crypto';
import os from 'node:os';
import { PostHog } from 'posthog-node';
import jwtDecode from 'jwt-decode';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { DecodedAccessToken } from '../commands/auth/utils.js';
import { config, getBaseHeaders, getLoginDetails } from './config.js';
import { CreateClient } from './client/client.js';

// Environment variables to allow opting out of telemetry
// Support for COSMO_TELEMETRY_DISABLED and Console Do Not Track standard
const TELEMETRY_DISABLED = process.env.COSMO_TELEMETRY_DISABLED === 'true' || process.env.DO_NOT_TRACK === '1';

let client: PostHog | null = null;

let apiClient: ReturnType<typeof CreateClient> | null = null;

let identifiedEmail: string | null = null;

let aliasedDistinctId: string | null = null;

let groupedOrganizationSlug: string | null = null;

type PostHogFetchOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  mode?: 'no-cors';
  credentials?: 'omit';
  headers: {
    [key: string]: string;
  };
  body?: string;
  signal?: AbortSignal;
};

type PostHogFetchResponse = {
  status: number;
  text: () => Promise<string>;
  json: () => Promise<any>;
};

const buildPostHogOkResponse = () => ({
  status: 200,
  text: () => Promise.resolve(''),
  json: () => Promise.resolve({}),
});

type TelemetryIdentity = {
  distinctId: string;
  email?: string;
  organizationSlug?: string;
  previousDistinctId?: string;
};

// PostHog logs flush failures directly; treat network issues as no-ops for CLI UX.
// This will also make the retry mechanism ineffective.
async function safePostHogFetch(url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> {
  try {
    const response = await fetch(url, options);
    if (response.status < 200 || response.status >= 400) {
      if (process.env.DEBUG) {
        console.error(`PostHog request failed with status ${response.status}.`);
      }
      return buildPostHogOkResponse();
    }
    return response;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error('PostHog request failed.', err);
    }
    return buildPostHogOkResponse();
  }
}

// Detect if running in a CI environment
const isCI = (): boolean => {
  return Boolean(
    process.env.CI || // Travis CI, CircleCI, GitLab CI, GitHub Actions, etc.
      process.env.CONTINUOUS_INTEGRATION ||
      process.env.BUILD_NUMBER || // Jenkins
      process.env.TEAMCITY_VERSION || // TeamCity
      process.env.GITLAB_CI ||
      process.env.GITHUB_ACTIONS ||
      process.env.BUILDKITE,
  );
};

/**
 * Check if the CLI is talking to Cosmo Cloud or a self-hosted instance
 */
const isTalkingToCosmoCloud = (): boolean => {
  const cloudUrl = 'https://cosmo-cp.wundergraph.com';
  return config.baseURL.startsWith(cloudUrl);
};

/**
 * Initialize PostHog client
 * This should be called once at the start of the CLI
 */
export const initTelemetry = () => {
  if (TELEMETRY_DISABLED) {
    return;
  }

  const posthogApiKey = process.env.POSTHOG_API_KEY || 'phc_CEnvoyw3KcTuC5E1seDPrgvAamgGRDLfzPi1e7RU1G1';
  const posthogHost = process.env.POSTHOG_HOST || 'https://eu.i.posthog.com';

  client = new PostHog(posthogApiKey, {
    host: posthogHost,
    flushAt: 1, // For CLI, we want to send events immediately
    flushInterval: 0, // Don't wait to flush events
    disableGeoip: false,
    fetch: safePostHogFetch,
  });

  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  apiClient = CreateClient({
    baseUrl: config.baseURL,
    apiKey: config.apiKey,
    proxyUrl,
  });

  // Handle errors silently to not interrupt CLI operations
  client.on('error', (err) => {
    if (process.env.DEBUG) {
      console.error('Telemetry error:', err);
    }
  });
};

/**
 * Generate a consistent distinct ID
 * Prefers the user email when available and attaches the current organization as a group.
 */
const getEmailFromToken = (token?: string): string | undefined => {
  if (!token) {
    return undefined;
  }

  try {
    const decoded = jwtDecode<DecodedAccessToken>(token);
    return decoded.email || undefined;
  } catch {
    return undefined;
  }
};

const getIdentityFromLoginDetails = (): TelemetryIdentity => {
  const loginDetails = getLoginDetails();
  const email = getEmailFromToken(loginDetails?.accessToken);
  const organizationSlug = loginDetails?.organizationSlug || undefined;

  return {
    distinctId: email ?? organizationSlug ?? 'anonymous',
    email,
    organizationSlug,
    previousDistinctId: email && organizationSlug ? organizationSlug : undefined,
  };
};

const getIdentityFromApiKey = async (): Promise<TelemetryIdentity | null> => {
  if (!config.apiKey) {
    return null;
  }

  const email = getEmailFromToken(config.apiKey);

  try {
    if (!apiClient) {
      return {
        distinctId: email ?? 'anonymous',
        email,
      };
    }

    const resp = await apiClient.platform.whoAmI(
      {},
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      const organizationSlug = resp.organizationSlug || undefined;

      return {
        distinctId: email ?? organizationSlug ?? 'anonymous',
        email,
        organizationSlug,
        previousDistinctId: email && organizationSlug ? organizationSlug : undefined,
      };
    }

    return {
      distinctId: email ?? 'anonymous',
      email,
    };
  } catch {
    return {
      distinctId: email ?? 'anonymous',
      email,
    };
  }
};

const getIdentity = async (): Promise<TelemetryIdentity> => {
  const apiKeyIdentity = await getIdentityFromApiKey();
  if (apiKeyIdentity) {
    return apiKeyIdentity;
  }

  return getIdentityFromLoginDetails();
};

const syncIdentity = (identity: TelemetryIdentity) => {
  if (!client) {
    return;
  }

  if (identity.email && identity.previousDistinctId && identity.previousDistinctId !== identity.email) {
    const aliasKey = `${identity.previousDistinctId}->${identity.email}`;
    if (aliasedDistinctId !== aliasKey) {
      client.alias({
        distinctId: identity.previousDistinctId,
        alias: identity.email,
      });
      aliasedDistinctId = aliasKey;
    }
  }

  if (identity.email && identifiedEmail !== identity.email) {
    client.identify({
      distinctId: identity.email,
      properties: {
        email: identity.email,
        organizationSlug: identity.organizationSlug,
      },
    });
    identifiedEmail = identity.email;
  }

  if (identity.organizationSlug && groupedOrganizationSlug !== identity.organizationSlug) {
    client.groupIdentify({
      groupType: 'orgslug',
      groupKey: identity.organizationSlug,
      properties: {
        organizationSlug: identity.organizationSlug,
      },
      distinctId: identity.email ?? identity.distinctId,
    });
    groupedOrganizationSlug = identity.organizationSlug;
  }
};

/**
 * Capture a usage event
 */
export const capture = async (eventName: string, properties: Record<string, any> = {}) => {
  if (TELEMETRY_DISABLED || !client) {
    return;
  }

  try {
    const identity = await getIdentity();
    const metadata = getMetadata();
    syncIdentity(identity);

    client.capture({
      distinctId: identity.distinctId,
      event: eventName,
      groups: identity.organizationSlug
        ? {
            orgslug: identity.organizationSlug,
          }
        : undefined,
      properties: {
        ...metadata,
        ...properties,
      },
    });
  } catch (err) {
    // Silently fail to not disrupt CLI operations
    if (process.env.DEBUG) {
      console.error('Failed to capture telemetry event:', err);
    }
  }
};

/**
 * Capture a command failure event with error details
 */
export const captureCommandFailure = async (command: string, error: Error | string) => {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : undefined;

  await capture('command_failure', {
    command,
    error_message: errorMessage,
    error_stack: errorStack,
  });
};

/**
 * Get CLI metadata to include with all events
 */
const getMetadata = (): Record<string, any> => {
  const machineId = crypto.hash('sha256', os.hostname(), 'hex');

  return {
    cli_version: config.version,
    node_version: process.version,
    os_name: process.platform,
    os_version: process.release?.name || '',
    platform: process.arch,
    machine_id: machineId,
    is_ci: isCI(),
    is_cosmo_cloud: isTalkingToCosmoCloud(),
  };
};

/**
 * Shutdown PostHog client - should be called before CLI exits
 */
export const shutdownTelemetry = async () => {
  if (client) {
    try {
      await client.shutdown();
    } catch (err) {
      // Silently fail
      if (process.env.DEBUG) {
        console.error('Failed to shutdown telemetry:', err);
      }
    }
  }
};
