import { config } from '../../core/config.js';

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
  requestBody.append('scope', 'openid');
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
  requestBody.append('scope', 'openid');

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
    const body = await response.json();
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
