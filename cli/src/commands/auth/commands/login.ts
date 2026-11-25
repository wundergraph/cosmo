import { setTimeout as delay } from 'node:timers/promises';
import { Command } from 'commander';
import inquirer from 'inquirer';
import open from 'open';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { createOutput, readOutputOverride, toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Failure, Output } from '@wundergraph/wgc-plugin-sdk';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { commandName, config, getBaseHeaders } from '../../../core/config.js';
import { ConfigData, readConfigFile, updateConfigFile } from '../../../utils.js';
import { describeHubAudience, readHubAudience } from '../hub-audience.js';
import { organizationSlugs, pollForToken, requestDeviceAuthorization } from '../device-login.js';
import type { DeviceAuthorization, KeycloakEndpoints } from '../device-login.js';
import type { KeycloakToken } from '../utils.js';

interface LoginOptions {
  nonInteractive?: boolean;
  complete?: string;
  org?: string;
  json?: boolean;
}

export interface OrganizationChoice {
  slug: string;
  label: string;
}

/** Everything the login touches outside wgc, so tests can stand in for the browser and identity server. */
export interface LoginDependencies {
  fetchImpl: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  openBrowser: (url: string) => Promise<void>;
  saveSession: (session: ConfigData) => void;
  readSession: () => ConfigData;
  /** True when a person sits at the terminal: stdin and stdout are TTYs. */
  interactive: boolean;
  createOutput: (json: boolean) => Output;
  describeOrganizations: (accessToken: string, slugs: string[]) => Promise<OrganizationChoice[]>;
  chooseOrganization: (choices: OrganizationChoice[]) => Promise<string>;
  endpoints: KeycloakEndpoints;
}

const defaultDependencies = (opts: BaseCommandOptions): LoginDependencies => ({
  fetchImpl: fetch,
  sleep: async (milliseconds) => {
    await delay(milliseconds);
  },
  openBrowser: async (url) => {
    await open(url);
  },
  saveSession: updateConfigFile,
  readSession: readConfigFile,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  createOutput: (json) => createOutput({ json: json || readOutputOverride(process.env) === 'json' }),
  describeOrganizations: async (accessToken, slugs) => {
    const choices: OrganizationChoice[] = [];
    for (const slug of slugs) {
      const response = await opts.client.platform.getOrganizationBySlug(
        { slug },
        { headers: { ...getBaseHeaders(), authorization: `Bearer ${accessToken}`, 'cosmo-org-slug': slug } },
      );
      const found = response.response?.code === EnumStatusCode.OK ? response.organization : undefined;
      choices.push({ slug, label: found ? `${found.name} (${slug})` : slug });
    }
    return choices;
  },
  chooseOrganization: async (choices) => {
    const answer = await inquirer.prompt<{ slug: string }>({
      name: 'slug',
      type: 'list',
      message: 'Select Organization:',
      choices: choices.map((choice) => ({ name: choice.label, value: choice.slug })),
    });
    return answer.slug;
  },
  endpoints: { apiUrl: config.kcApiURL, realm: config.kcRealm, clientId: config.kcClientId },
});

const completeCommand = (deviceCode: string, org: string | undefined): string =>
  org === undefined
    ? `${commandName} auth login --complete ${deviceCode}`
    : `${commandName} auth login --complete ${deviceCode} --org ${org}`;

/** Agents get the browser URL and pairing code to hand to a person, and the command that finishes the login. */
const printLoginStart = (output: Output, authorization: DeviceAuthorization, org: string | undefined): void => {
  const nextStep = completeCommand(authorization.deviceCode, org);
  output.result(
    {
      browser_url: authorization.browserUrl,
      verification_code: authorization.userCode,
      expires_in: authorization.expiresInSeconds,
      next_step: nextStep,
    },
    (data) =>
      [
        `Open ${data.browser_url}`,
        `and approve the login with the code ${data.verification_code}. Then run the next command.`,
      ].join('\n'),
    { next: [{ command: nextStep, description: 'finish the login once the browser shows it approved' }] },
  );
};

/**
 * The organization to sign in to: `--org`, the only one, or the person's choice. Never a guess.
 * `deviceCode` is the `--complete` code; without one a person is there to ask.
 */
const pickOrganization = async (
  token: KeycloakToken,
  options: LoginOptions,
  dependencies: LoginDependencies,
  deviceCode: string | undefined,
): Promise<{ slug: string } | { failure: Failure }> => {
  const slugs = organizationSlugs(token.accessToken);
  if (slugs.length === 0) {
    return {
      failure: {
        kind: 'unauthenticated',
        code: 'NO_ORGANIZATION',
        message: 'Your account is not part of any organization on Cosmo.',
        remediation: 'Sign in to Cosmo in the browser, join or create an organization, then log in again.',
      },
    };
  }

  if (options.org !== undefined) {
    if (slugs.includes(options.org)) {
      return { slug: options.org };
    }
    return {
      failure: {
        kind: 'usage',
        message: `Your account is not part of the organization ${options.org}.`,
        remediation: `Pass one of: ${slugs.join(', ')}.`,
      },
    };
  }

  if (slugs.length === 1) {
    return { slug: slugs[0] };
  }

  if (deviceCode !== undefined) {
    // The identity server redeems a device code once, so keep the token for the rerun with --org.
    dependencies.saveSession({ pendingLogin: { ...token, deviceCode } });
    const finish = completeCommand(deviceCode, '<slug>');
    return {
      failure: {
        kind: 'usage',
        message: `Your account belongs to ${slugs.length} organizations: ${slugs.join(', ')}.`,
        remediation: `Finish this login with the one to use: \`${finish}\`.`,
        next: [finish],
      },
    };
  }

  const choices = await dependencies.describeOrganizations(token.accessToken, slugs);
  return { slug: await dependencies.chooseOrganization(choices) };
};

const finishLogin = async (
  output: Output,
  token: KeycloakToken,
  options: LoginOptions,
  dependencies: LoginDependencies,
  deviceCode: string | undefined,
): Promise<void> => {
  const picked = await pickOrganization(token, options, dependencies, deviceCode);
  if ('failure' in picked) {
    output.fail(picked.failure);
    return;
  }

  dependencies.saveSession({ ...token, organizationSlug: picked.slug, pendingLogin: undefined });

  const hubAudience = readHubAudience(token.accessToken);
  output.result({ organizationSlug: picked.slug, hubAudience: hubAudience ?? null }, (data) =>
    [
      `Logged in to ${data.organizationSlug}.`,
      ...(data.hubAudience ? [`Hub (${config.hubURL}): ${describeHubAudience(data.hubAudience)}`] : []),
    ].join('\n'),
  );
};

const runLogin = async (options: LoginOptions, dependencies: LoginDependencies): Promise<void> => {
  const agentMode = options.nonInteractive === true || options.complete !== undefined || !dependencies.interactive;
  const output = dependencies.createOutput(options.json === true || agentMode);

  if (options.complete !== undefined) {
    const { pendingLogin } = dependencies.readSession();
    if (pendingLogin?.deviceCode === options.complete) {
      const { deviceCode, ...token } = pendingLogin;
      await finishLogin(output, token, options, dependencies, deviceCode);
      return;
    }

    const token = await pollForToken({
      fetchImpl: dependencies.fetchImpl,
      endpoints: dependencies.endpoints,
      deviceCode: options.complete,
      intervalSeconds: 5,
      sleep: dependencies.sleep,
    });
    if (!token.success) {
      output.fail(toFailure(token));
      return;
    }
    await finishLogin(output, token.data, options, dependencies, options.complete);
    return;
  }

  const authorization = await requestDeviceAuthorization(dependencies.fetchImpl, dependencies.endpoints);
  if (!authorization.success) {
    output.fail(toFailure(authorization));
    return;
  }

  if (agentMode) {
    printLoginStart(output, authorization.data, options.org);
    return;
  }

  const { userCode, browserUrl, deviceCode, intervalSeconds } = authorization.data;
  output.message(
    [
      `Pairing code  ${userCode}`,
      'Check that your browser shows the same code before you approve the login.',
      `  ${browserUrl}`,
      '',
    ].join('\n'),
  );
  await dependencies.openBrowser(browserUrl);

  const token = await pollForToken({
    fetchImpl: dependencies.fetchImpl,
    endpoints: dependencies.endpoints,
    deviceCode,
    intervalSeconds,
    sleep: dependencies.sleep,
  });
  if (!token.success) {
    output.fail(toFailure(token));
    return;
  }
  await finishLogin(output, token.data, options, dependencies, undefined);
};

export default (opts: BaseCommandOptions, dependencies: LoginDependencies = defaultDependencies(opts)) =>
  new Command('login')
    .description(
      'Log in to Cosmo in the browser. The terminal and the browser show the same pairing code; approve only when they match.',
    )
    .option(
      '--non-interactive',
      'Print the browser URL, pairing code and the command that finishes the login as JSON, then exit. The default when stdin is not a terminal.',
    )
    .option('--complete <device-code>', 'Finish a login started with --non-interactive once it was approved.')
    .option('--org <slug>', 'The organization to log in to, for accounts in several.')
    .option('--json', 'Machine-readable output')
    .addHelpText(
      'after',
      ['', 'Examples', `  ${commandName} auth login`, `  ${commandName} auth login --non-interactive --org acme`].join(
        '\n',
      ),
    )
    .action((options: LoginOptions) => runLogin(options, dependencies));
