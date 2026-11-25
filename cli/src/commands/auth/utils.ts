import { program } from 'commander';
import pc from 'picocolors';
import { commandName, config } from '../../core/config.js';
import { readConfigFile, updateConfigFile } from '../../utils.js';

export interface KeycloakToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  refreshExpiresAt: Date;
}

export interface KeycloakTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
}

export type GraphTokenFeature = 'split-config-loading';

export interface GraphToken {
  iss?: string;
  iat?: number;
  federated_graph_id: string;
  organization_id: string;
  features?: GraphTokenFeature[];
}

export interface DecodedAccessToken {
  iss?: string;
  sub?: string;
  aud?: string[] | string;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  groups: string[];
  email: string;
}

/**
 * Checks if either of access token or api key are present.
 * If not, it will try to refresh the access token
 *
 * @param [showErrorMessage] - when `false`, any and all error message will be skipped
 */
export async function checkAuth(showErrorMessage = true): Promise<void> {
  const userConfig = readConfigFile();

  if (config.apiKey && userConfig.accessToken && showErrorMessage) {
    console.error(
      `${pc.yellow('Warning')} ${pc.dim(
        'Both COSMO_API_KEY and login credentials found. Environment variable has precedence.\n',
      )}`,
    );
  }

  // API Key is present and assumed to be valid
  if (config.apiKey) {
    return;
  }

  // In CI, the job's OIDC identity earns the control plane credential.
  const { useCiIdentityForCosmo } = await import('../../core/ci-oidc.js');
  const ciIdentity = await useCiIdentityForCosmo();
  if (!ciIdentity.success) {
    if (!showErrorMessage) {
      return;
    }
    program.error(pc.red(ciIdentity.errors.map((error) => error.message).join('; ')));
  }
  if (config.apiKey) {
    return;
  }

  if (!userConfig.organizationSlug) {
    if (!showErrorMessage) {
      return;
    }

    program.error(
      pc.red(`Organization slug is not set. Please run \`${commandName} auth login\` to set the organization slug.`),
    );
  }

  // Access token is present and does not expire in the next 60 seconds
  if (
    userConfig?.accessToken &&
    userConfig?.expiresAt &&
    new Date(userConfig.expiresAt) > new Date(Date.now() - 60 * 1000)
  ) {
    // Update the api key to the current valid access token
    config.apiKey = userConfig.accessToken;
    return;
  }

  // Check if refresh token is expired
  if (userConfig?.refreshToken && userConfig?.refreshExpiresAt && new Date(userConfig.refreshExpiresAt) < new Date()) {
    if (!showErrorMessage) {
      return;
    }

    program.error(pc.red(`Refresh token has expired. Please login again with \`${commandName} auth login\``));
  }

  // Refresh tokens with the offline token
  const resp = await fetch(`${config.kcApiURL}/realms/${config.kcRealm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.kcClientId,
      refresh_token: userConfig.refreshToken!,
    }),
  });

  if (resp.status !== 200) {
    throw new Error(
      'Failed to refresh access token. If the issue persists, please contact support. StatusCode: ' + resp.status,
    );
  }

  try {
    const data: KeycloakTokenResponse = await resp.json();
    const present = new Date();

    // Update the config file with the new access token and refresh token
    updateConfigFile({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(new Date().setSeconds(present.getSeconds() + data.expires_in)),
      refreshExpiresAt: new Date(new Date().setSeconds(present.getSeconds() + data.refresh_expires_in)),
      organizationSlug: userConfig.organizationSlug,
    });

    // Update the api key with the new access token
    config.apiKey = data.access_token;
  } catch (e: any) {
    throw new Error(
      'Failed to parse the response from the identity server. If the issue persists, please contact support. Error: ' +
        e.toString(),
    );
  }
}

/**
 * Perform access token refresh and updates the value for `config.apiKey` accordingly  (if needed);
 * however, if the value for `config.apiKey` remains empty, that means the user is not authenticated or the
 * token refresh failed
 *
 * @returns {boolean} A value indicating whether the client is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    await checkAuth(false);
  } catch {
    // ignore
  }

  return Boolean(config.apiKey);
}
