import type { ConfigData } from '../../utils.js';
import type { KeycloakTokenResponse } from '../auth/utils.js';

export type AuthMode = 'user' | 'api-key';

export type AuthProvider = {
  mode: AuthMode;
  getHeaders(): Promise<Record<string, string>>;
};

const REFRESH_MARGIN_MS = 60_000;

/**
 * Supplies request headers for the long-running MCP server. Unlike `checkAuth`, it refreshes the login token
 * whenever it is about to expire, and never exits the process: failures are thrown so the calling tool can
 * return them to the client.
 *
 * `user` mode acts as the logged-in user (`wgc auth login`), so namespace login-method restrictions apply.
 * `api-key` mode uses COSMO_API_KEY, whose group permissions apply but which bypasses those restrictions.
 */
export function createAuthProvider(deps: {
  mode?: AuthMode;
  apiKey?: string;
  version: string;
  readConfig: () => ConfigData;
  writeConfig: (data: ConfigData) => void;
  refresh: (refreshToken: string) => Promise<KeycloakTokenResponse>;
  now?: () => Date;
}): AuthProvider {
  const mode: AuthMode = deps.mode ?? (deps.apiKey ? 'api-key' : 'user');
  const now = deps.now ?? (() => new Date());
  const baseHeaders = {
    'user-agent': `cosmo-cli/${deps.version}`,
    'x-cosmo-client': `wgc-mcp/${deps.version}`,
  };
  let inFlightRefresh: Promise<ConfigData> | undefined;

  const refreshLogin = async (config: ConfigData): Promise<ConfigData> => {
    if (!config.refreshToken || !config.refreshExpiresAt || new Date(config.refreshExpiresAt) <= now()) {
      throw new Error('Your login expired. Run `wgc auth login`.');
    }
    const tokens = await deps.refresh(config.refreshToken);
    const issuedAt = now().getTime();
    const refreshed: ConfigData = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(issuedAt + tokens.expires_in * 1000),
      refreshExpiresAt: new Date(issuedAt + tokens.refresh_expires_in * 1000),
      organizationSlug: config.organizationSlug,
    };
    deps.writeConfig(refreshed);
    return refreshed;
  };

  const userHeaders = async () => {
    let config = deps.readConfig();
    if (!config.accessToken || !config.organizationSlug) {
      throw new Error('Not logged in. Run `wgc auth login`.');
    }
    if (!config.expiresAt || new Date(config.expiresAt).getTime() <= now().getTime() + REFRESH_MARGIN_MS) {
      inFlightRefresh ??= refreshLogin(config).finally(() => {
        inFlightRefresh = undefined;
      });
      config = await inFlightRefresh;
    }
    return {
      ...baseHeaders,
      authorization: `Bearer ${config.accessToken}`,
      'cosmo-org-slug': config.organizationSlug ?? '',
    };
  };

  return {
    mode,
    getHeaders() {
      if (mode === 'user') {
        return userHeaders();
      }
      if (!deps.apiKey) {
        return Promise.reject(new Error('COSMO_API_KEY is not set.'));
      }
      return Promise.resolve({ ...baseHeaders, authorization: `Bearer ${deps.apiKey}` });
    },
  };
}
