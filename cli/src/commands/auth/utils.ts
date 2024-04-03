import { program } from 'commander';
import pc from 'picocolors';
import { config } from '../../core/config.js';
import { readConfigFile, updateConfigFile } from '../../utils.js';

interface DeviceAuthResponse {
  deviceCode: string;
  userCode: string;
  verificationURI: string;
  interval: number;
}

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

export interface GraphToken {
  iss?: string;
  iat?: number;
  federated_graph_id: string;
  organization_id: string;
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

export const performDeviceAuth = async (): Promise<{
  success: boolean;
  response: DeviceAuthResponse;
  errorMessage?: string;
}> => {
  const headers = new Headers();
  headers.append('Content-Type', 'application/x-www-form-urlencoded');

  const requestBody = new URLSearchParams();
  requestBody.append('scope', 'openid offline_access');
  requestBody.append('client_id', config.kcClientId);

  const response = await fetch(`${config.kcApiURL}/realms/${config.kcRealm}/protocol/openid-connect/auth/device`, {
    method: 'POST',
    headers,
    body: requestBody,
  });
  if (response.status !== 200) {
    return {
      success: false,
      errorMessage: 'Could not perform device authentication.',
      response: {
        deviceCode: '',
        userCode: '',
        verificationURI: '',
        interval: 0,
      },
    };
  }
  const body = await response.json();
  return {
    success: true,
    response: {
      deviceCode: body.device_code,
      userCode: body.user_code,
      verificationURI: body.verification_uri_complete,
      interval: body.interval,
    },
  };
};

export const startPollingForAccessToken = async ({
  deviceCode,
  interval,
}: {
  deviceCode: string;
  interval: number;
}): Promise<{ success: boolean; response?: KeycloakToken; errorMessage?: string }> => {
  const headers = new Headers();
  headers.append('Content-Type', 'application/x-www-form-urlencoded');

  const requestBody = new URLSearchParams();
  requestBody.append('client_id', config.kcClientId);
  requestBody.append('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
  requestBody.append('device_code', deviceCode);
  // Request an offline token https://wjw465150.gitbooks.io/keycloak-documentation/content/server_admin/topics/sessions/offline.html
  requestBody.append('scope', 'openid offline_access');

  while (true) {
    const response = await fetch(`${config.kcApiURL}/realms/${config.kcRealm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers,
      body: requestBody,
    });
    if (response.status === 400) {
      // Sleep for the retry interval and print a dot for each second.
      for (let i = 0; i < interval; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      continue;
    }
    if (response.status !== 200) {
      return {
        success: false,
        errorMessage: 'Could not fetch the access token.',
      };
    }
    const body: KeycloakTokenResponse = await response.json();

    const present = new Date();
    return {
      success: true,
      response: {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: new Date(new Date().setSeconds(present.getSeconds() + body.expires_in)),
        refreshExpiresAt: new Date(new Date().setSeconds(present.getSeconds() + body.refresh_expires_in)),
      },
    };
  }
};

// checks if either of access token or api key are present
// if not, it will try to refresh the access token
export async function checkAuth(silent = false) {
  const userConfig = readConfigFile();

  if (!userConfig.organizationSlug) {
    program.error(pc.red('Organization slug is not set. Please run `wgc auth login` to set the organization slug.'));
  }

  if (config.apiKey && userConfig.accessToken) {
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
    program.error(pc.red('Refresh token has expired. Please login again with `wgc auth login`'));
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
