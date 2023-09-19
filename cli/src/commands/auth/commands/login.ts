import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Command, program } from 'commander';
import yaml from 'js-yaml';
import open from 'open';
import pc from 'picocolors';
import { configDir, configFile } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { performDeviceAuth, startPollingForAccessToken } from '../utils.js';

export default (opts: BaseCommandOptions) => {
  const loginCommand = new Command('login');
  loginCommand.description('Login a user.');

  loginCommand.action(async () => {
    if (existsSync(configFile)) {
      const data = yaml.load(readFileSync(configFile, 'utf8'));
      const loginData = JSON.parse(JSON.stringify(data));
      if (loginData && loginData?.expiresAt && new Date(loginData.expiresAt) > new Date()) {
        console.log(pc.green('You are already logged in.'));
        process.exit(0);
      }
    }

    const resp = await performDeviceAuth({ cliClientId: 'cosmo-cli' });
    if (!resp.success) {
      program.error('Could not perform authentication. Please try again');
    }
    console.log('Code: %s\n', resp.response.deviceCode);
    console.log(
      'If your browser does not automatically open, use this URL and enter the Code to verify the login: %s\n',
      resp.response.verificationURI,
    );
    console.log('Opening browser for login...\n');
    await open(resp.response.verificationURI);

    const accessTokenResp = await startPollingForAccessToken({
      cliClientId: 'cosmo-cli',
      deviceCode: resp.response.deviceCode,
      interval: resp.response.interval,
    });

    if (!accessTokenResp.success) {
      program.error(accessTokenResp.errorMessage + ' Please try again.');
    }

    mkdirSync(configDir, { recursive: true });
    const token = yaml.dump(accessTokenResp.response);
    await writeFile(configFile, token);

    console.log(pc.green('Logged in Successfully!'));
  });

  return loginCommand;
};
