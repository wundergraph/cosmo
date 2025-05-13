import os from 'node:os';
import { PostHog } from 'posthog-node';
import { config, getBaseHeaders } from './config.js';

// Environment variables to allow opting out of telemetry
// Support for COSMO_TELEMETRY_DISABLED and Console Do Not Track standard
const TELEMETRY_DISABLED =
  process.env.COSMO_TELEMETRY_DISABLED === 'true' || process.env.DO_NOT_TRACK === '1' || !process.env.POSTHOG_API_KEY;

let client: PostHog | null = null;

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
 * Initialize PostHog client
 * This should be called once at the start of the CLI
 */
export const initTelemetry = () => {
  if (TELEMETRY_DISABLED) {
    return;
  }

  const posthogApiKey = process.env.POSTHOG_API_KEY || '';
  const posthogHost = process.env.POSTHOG_HOST || 'https://eu.i.posthog.com';

  client = new PostHog(posthogApiKey, {
    host: posthogHost,
    flushAt: 1, // For CLI, we want to send events immediately
    flushInterval: 0, // Don't wait to flush events
    disableGeoip: false,
  });

  // Handle errors silently to not interrupt CLI operations
  client.on('error', (err) => {
    if (process.env.DEBUG) {
      console.error('Telemetry error:', err);
    }
  });
};

/**
 * Capture a usage event
 */
export const capture = (eventName: string, properties: Record<string, any> = {}) => {
  if (TELEMETRY_DISABLED || !client) {
    return;
  }

  try {
    const distinctId = getDistinctId();
    const metadata = getMetadata();

    client.capture({
      distinctId,
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
 * Generate a consistent distinct ID
 */
const getDistinctId = (): string => {
  // Use organization slug if available
  const headers = getBaseHeaders();
  // Convert HeadersInit to Record to safely access properties
  const headersRecord = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, value.toString()]));
  const organizationSlug = headersRecord['cosmo-org-slug'] || 'anonymous';
  return `cli_${organizationSlug}`;
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
