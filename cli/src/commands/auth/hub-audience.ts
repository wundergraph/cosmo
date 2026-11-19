import jwtDecode from 'jwt-decode';
import { z } from 'zod';
import { config } from '../../core/config.js';

const audienceClaims = z.object({ aud: z.union([z.string(), z.array(z.string())]).optional() });

export interface HubAudience {
  /** The token's `aud` claim as a list. */
  audiences: string[];
  /** Hub accepts only tokens whose audience includes `config.hubOidcAudience`. */
  acceptedByHub: boolean;
}

/** Reads the audience of a sign-in or CI OIDC token. Undefined for an API key, which is not a JWT. */
export const readHubAudience = (token: string): HubAudience | undefined => {
  let payload: object;
  try {
    payload = jwtDecode<object>(token);
  } catch {
    return undefined;
  }

  const claims = audienceClaims.safeParse(payload);
  if (!claims.success) {
    return undefined;
  }

  const { aud = [] } = claims.data;
  const audiences = typeof aud === 'string' ? [aud] : aud;
  return { audiences, acceptedByHub: audiences.includes(config.hubOidcAudience) };
};

export const describeHubAudience = ({ audiences, acceptedByHub }: HubAudience): string => {
  const listed = audiences.length === 0 ? 'none' : audiences.join(', ');
  if (acceptedByHub) {
    return `accepted (token audience: ${listed})`;
  }
  return `not accepted, Hub needs audience "${config.hubOidcAudience}" (token audience: ${listed})`;
};
