import { Command, program } from 'commander';
import open from 'open';
import pc from 'picocolors';
import jwtDecode from 'jwt-decode';
import inquirer from 'inquirer';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import ora from 'ora';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { DecodedAccessToken, performDeviceAuth, startPollingForAccessToken } from '../utils.js';
import { updateConfigFile } from '../../../utils.js';
import { getBaseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const loginCommand = new Command('login');
  loginCommand.description('Login a user into the Cosmo platform. Supports browser-based authentication.');

  loginCommand.action(async () => {
    const resp = await performDeviceAuth();
    if (!resp.success) {
      program.error(pc.red('Could not perform authentication. Please try again'));
    }
    console.log('Code: %s\n', resp.response.deviceCode);
    console.log(
      'If your browser does not automatically open, use this URL and enter the Code to verify the login: %s\n',
      resp.response.verificationURI,
    );
    console.log('Opening browser for login...\n');
    await open(resp.response.verificationURI);

    const accessTokenResp = await startPollingForAccessToken({
      deviceCode: resp.response.deviceCode,
      interval: resp.response.interval,
    });

    if (!accessTokenResp.success) {
      program.error(pc.red(accessTokenResp.errorMessage + ' Please try again.'));
    }

    if (!accessTokenResp.response) {
      program.error(pc.red('Could not perform authentication. Please try again'));
    }

    let decoded: DecodedAccessToken;

    try {
      decoded = jwtDecode<DecodedAccessToken>(accessTokenResp.response.accessToken);
    } catch {
      program.error(pc.red('Could not perform authentication. Please try again'));
    }

    if (!decoded.groups) {
      program.error(
        pc.red(
          'You are not part of any organizations on Cosmo. Please login to your account in the browser and try again.',
        ),
      );
    }

    const organizationSlugs = new Set(decoded.groups.map((group) => group.split('/')[1]));

    const organizationSlugByDisplayKey = new Map<string, string>();
    const organizationKeys: Array<string> = [];
    const spinner = ora('Fetching organizations...').start();
    for (const organizationSlug of organizationSlugs) {
      const headers = getBaseHeaders();
      const response = await opts.client.platform.getOrganizationBySlug(
        {
          slug: organizationSlug,
        },
        {
          headers: {
            ...headers,
            authorization: `Bearer ${accessTokenResp.response.accessToken}`,
            'cosmo-org-slug': organizationSlug,
          },
        },
      );
      if (!response.response || response.response.code !== EnumStatusCode.OK || !response.organization) {
        organizationKeys.push(organizationSlug);
        organizationSlugByDisplayKey.set(organizationSlug, organizationSlug);
        continue;
      }
      const organizationKey = `${response.organization.name} (${organizationSlug})`;
      organizationKeys.push(organizationKey);
      organizationSlugByDisplayKey.set(organizationKey, organizationSlug);
    }

    spinner.stop();

    const selectedOrganization = await inquirer.prompt({
      name: 'organizationKey',
      type: 'list',
      message: 'Select Organization:',
      choices: organizationKeys,
    });

    const organizationSlug = organizationSlugByDisplayKey.get(selectedOrganization.organizationKey);

    if (!organizationSlug) {
      program.error('Unable to login.');
    }

    updateConfigFile({ ...accessTokenResp.response, organizationSlug });

    console.log(pc.green('Logged in Successfully!'));
  });

  return loginCommand;
};
