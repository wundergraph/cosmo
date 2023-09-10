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

export const performDeviceAuth = async ({
  cliClientId,
}: {
  cliClientId: string;
}): Promise<{ success: boolean; response: DeviceAuthResponse; errorMessage?: string }> => {
  const headers = new Headers();
  headers.append('Content-Type', 'application/x-www-form-urlencoded');

  const requestBody = new URLSearchParams();
  requestBody.append('client_id', cliClientId);

  const response = await fetch(config.kcApiURL + '/realms/cosmo/protocol/openid-connect/auth/device', {
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
  cliClientId,
  deviceCode,
  interval,
}: {
  cliClientId: string;
  deviceCode: string;
  interval: number;
}): Promise<{ success: boolean; response?: KeycloakToken; errorMessage?: string }> => {
  const headers = new Headers();
  headers.append('Content-Type', 'application/x-www-form-urlencoded');

  const requestBody = new URLSearchParams();
  requestBody.append('client_id', cliClientId);
  requestBody.append('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
  requestBody.append('device_code', deviceCode);

  while (true) {
    const response = await fetch(config.kcApiURL + '/realms/cosmo/protocol/openid-connect/token', {
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
