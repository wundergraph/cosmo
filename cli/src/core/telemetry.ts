import os from 'node:os';
import { PostHog } from 'posthog-node';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { config, getBaseHeaders, getLoginDetails } from './config.js';
import { CreateClient } from './client/client.js';

// Environment variables to allow opting out of telemetry
// Support for COSMO_TELEMETRY_DISABLED and Console Do Not Track standard
const TELEMETRY_DISABLED = process.env.COSMO_TELEMETRY_DISABLED === 'true' || process.env.DO_NOT_TRACK === '1';

let client: PostHog | null = null;

let apiClient: ReturnType<typeof CreateClient> | null = null;

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
 * Uses the platform API to get the organization slug if available
 */
const getIdentity = async (): Promise<string> => {
  try {
    // First try to get the identity from the config file
    const loginDetails = getLoginDetails();
    if (loginDetails?.organizationSlug) {
      return loginDetails.organizationSlug;
    }

    // If not found, the user might be using an API key.
    // Call the whoAmI API to get organization information

    if (!apiClient) {
      return 'anonymous';
    }

    const resp = await apiClient.platform.whoAmI(
      {},
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      return resp.organizationSlug;
    }

    return 'anonymous';
  } catch {
    return 'anonymous';
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

    client.capture({
      distinctId: identity,
      event: eventName,
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
  return {
    cli_version: config.version,
    node_version: process.version,
    os_name: process.platform,
    os_version: process.release?.name || '',
    platform: process.arch,
    machine_id: os.hostname(),
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
