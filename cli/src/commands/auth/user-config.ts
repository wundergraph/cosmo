import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import yaml from 'js-yaml';
import pc from 'picocolors';
import { configDir, configFile } from '../../core/config.js';
import { KeycloakToken } from './utils.js';

export default class UserConfig {
  constructor() {}

  validateToken = () => {
    if (existsSync(configFile)) {
      const data = yaml.load(readFileSync(configFile, 'utf8'));
      if (!data) {
        return;
      }
      const loginData = JSON.parse(JSON.stringify(data));
      if (loginData && loginData?.accessToken && loginData?.expiresAt && new Date(loginData.expiresAt) > new Date()) {
        console.log(pc.green('You are already logged in.'));
        process.exit(0);
      }
    }
  };

  loadToken = (tokenResp: KeycloakToken & { organizationSlug: string }) => {
    mkdirSync(configDir, { recursive: true });
    const token = yaml.dump(tokenResp);
    writeFileSync(configFile, token);
  };
}
