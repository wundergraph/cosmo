import jwtDecode from 'jwt-decode';
import { z } from 'zod';
import { failure, failWith, ok } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { commandName } from '../../core/config.js';
import type { KeycloakToken } from './utils.js';

export interface KeycloakEndpoints {
  apiUrl: string;
  realm: string;
  clientId: string;
}

/** A pending browser login: the person approves `userCode` at `browserUrl`; wgc redeems `deviceCode`. */
export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  browserUrl: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}

const deviceAuthorizationResponse = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri_complete: z.string(),
  interval: z.number().default(5),
  expires_in: z.number().default(600),
});

const tokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  refresh_expires_in: z.number(),
});

const tokenError = z.object({ error: z.string() });

const scope = 'openid offline_access';

const openIdUrl = (endpoints: KeycloakEndpoints, path: string): string =>
  `${endpoints.apiUrl}/realms/${endpoints.realm}/protocol/openid-connect/${path}`;

export const requestDeviceAuthorization = async (
  fetchImpl: typeof fetch,
  endpoints: KeycloakEndpoints,
): Promise<Result<DeviceAuthorization>> => {
  const response = await fetchImpl(openIdUrl(endpoints, 'auth/device'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ scope, client_id: endpoints.clientId }),
  });
  if (response.status !== 200) {
    return failure(`The identity server refused to start a login (HTTP ${response.status}).`);
  }

  const parsed = deviceAuthorizationResponse.safeParse(await response.json());
  if (!parsed.success) {
    return failure('The identity server answered the login request without a device code.');
  }

  return ok({
    deviceCode: parsed.data.device_code,
    userCode: parsed.data.user_code,
    browserUrl: parsed.data.verification_uri_complete,
    intervalSeconds: parsed.data.interval,
    expiresInSeconds: parsed.data.expires_in,
  });
};

const secondsFromNow = (seconds: number): Date => new Date(Date.now() + seconds * 1000);

/** Redeems the device code once the person approved it; fails when they denied it or it expired. */
export const pollForToken = async ({
  fetchImpl,
  endpoints,
  deviceCode,
  intervalSeconds,
  sleep,
}: {
  fetchImpl: typeof fetch;
  endpoints: KeycloakEndpoints;
  deviceCode: string;
  intervalSeconds: number;
  sleep: (milliseconds: number) => Promise<void>;
}): Promise<Result<KeycloakToken>> => {
  let interval = intervalSeconds;

  while (true) {
    const response = await fetchImpl(openIdUrl(endpoints, 'token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: endpoints.clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        scope,
      }),
    });

    if (response.status === 200) {
      const granted = tokenResponse.safeParse(await response.json());
      if (!granted.success) {
        return failure('The identity server granted the login without the expected tokens.');
      }
      return ok({
        accessToken: granted.data.access_token,
        refreshToken: granted.data.refresh_token,
        expiresAt: secondsFromNow(granted.data.expires_in),
        refreshExpiresAt: secondsFromNow(granted.data.refresh_expires_in),
      });
    }

    const refused = tokenError.safeParse(await response.json().catch(() => ({})));
    const reason = refused.success ? refused.data.error : `HTTP ${response.status}`;
    if (reason === 'authorization_pending') {
      await sleep(interval * 1000);
      continue;
    }
    if (reason === 'slow_down') {
      interval += 5;
      await sleep(interval * 1000);
      continue;
    }

    return failWith({
      kind: 'unauthenticated',
      code: 'LOGIN_NOT_APPROVED',
      message:
        reason === 'expired_token'
          ? 'The login code expired before it was approved.'
          : `The login was not approved (${reason}).`,
      remediation: `Start a new login with \`${commandName} auth login\`.`,
      next: [`${commandName} auth login`],
    });
  }
};

const groupsClaim = z.object({ groups: z.array(z.string()).optional() });

/** The organization slugs of a sign-in token, from its `groups` claim (`/<slug>/...`). */
export const organizationSlugs = (accessToken: string): string[] => {
  let claims: object;
  try {
    claims = jwtDecode<object>(accessToken);
  } catch {
    return [];
  }

  const parsed = groupsClaim.safeParse(claims);
  const groups = parsed.success ? (parsed.data.groups ?? []) : [];
  return [...new Set(groups.map((group) => group.split('/')[1]).filter((slug) => slug !== undefined && slug !== ''))];
};
