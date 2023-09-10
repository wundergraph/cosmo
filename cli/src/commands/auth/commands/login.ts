import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { Command, program } from 'commander';
import open from 'open';
import pc from 'picocolors';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { performDeviceAuth, startPollingForAccessToken } from '../utils.js';

export default (opts: BaseCommandOptions) => {
  const loginCommand = new Command('login');
  loginCommand.description('Login a user.');

  loginCommand.action(async (name, options) => {
    const rootDir = process.cwd();
    // const rootDir = path.parse(process.cwd()).root;
    const dir = path.join(rootDir, 'cosmoConfig.yml');

    if (existsSync(dir)) {
      const data = yaml.load(readFileSync(dir, 'utf8'));
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

    // if (!fs.existsSync(dir)) {
    //   fs.mkdirSync(dir);
    // }

    const token = yaml.dump(accessTokenResp.response);
    await writeFile(dir, token);

    console.log(pc.green('Login Successful'));
  });

  return loginCommand;
};
