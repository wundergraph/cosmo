import pc from 'picocolors';
import { readConfigFile, updateConfigFile } from '../../utils.js';
import { KeycloakToken } from './utils.js';

export default class UserConfig {
  constructor() {}

  validateToken = () => {
    const data = readConfigFile();
    if (data?.accessToken && data?.expiresAt && new Date(data.expiresAt) > new Date()) {
      console.log(pc.green('You are already logged in.'));
      process.exit(0);
    }
  };

  loadToken = (tokenResp: KeycloakToken & { organizationSlug: string }) => {
    updateConfigFile({
      ...tokenResp,
    });
  };
}
