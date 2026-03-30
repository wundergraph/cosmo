import pc from 'picocolors';
import ora from 'ora';

import { Command, program } from 'commander';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { WhoAmIResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders, config } from '../../../core/config.js';
import { waitForKeyPress, rainbow } from '../../../utils.js';

type UserInfo = {
  userEmail: WhoAmIResponse['userEmail'];
  organizationName: WhoAmIResponse['organizationName'];
};

function clearScreen() {
  process.stdout.write('\u001Bc');
}

function printLogo() {
  console.log(`
        ▌            ▌
▌▌▌▌▌▛▌▛▌█▌▛▘▛▌▛▘▀▌▛▌▛▌
▚▚▘▙▌▌▌▙▌▙▖▌ ▙▌▌ █▌▙▌▌▌
             ▄▌    ▌
`);
}

function printHello() {
  printLogo();
  console.log(
    `\nThank you for choosing ${rainbow('WunderGraph')} - The open-source solution to building, maintaining, and collaborating on GraphQL Federation at Scale.\n`,
  );
  console.log('This command will guide you through the inital setup to create your first federated graph.');
}

async function printAccountDisclaimer() {
  await waitForKeyPress(
    { Enter: undefined },
    `It is recommended you run this command along the onboarding wizard at ${config.baseURL}/onboarding with the same account.\nPress ENTER to continue…`,
  );
}

async function checkExistingOnboarding(client: BaseCommandOptions['client']) {
  const { response, onboarding } = await client.platform.getOnboarding(
    {},
    {
      headers: getBaseHeaders(),
    },
  );

  if (response?.code !== EnumStatusCode.OK) {
    return {
      error: new Error(response?.details ?? 'Failed to fetch onboarding metadata.'),
      status: 'error',
    } as const;
  }

  if (!onboarding) {
    return { status: 'not-initiated' } as const;
  }

  if (onboarding && onboarding.step < 2) {
    return {
      status: 'step-too-soon',
    } as const;
  }

  return {
    onboarding,
    status: 'ok',
  } as const;
}

async function handleGetOnboardingResponse(client: BaseCommandOptions['client'], userInfo: UserInfo) {
  const onboardingCheck = await checkExistingOnboarding(client);

  async function retryFn() {
    return await handleGetOnboardingResponse(client, userInfo);
  }

  switch (onboardingCheck.status) {
    case 'ok': {
      return onboardingCheck.onboarding;
    }
    case 'not-initiated': {
      console.log(`Please start onboarding at ${config.baseURL}/onboarding first.`);
      await waitForKeyPress(
        {
          Enter: retryFn,
        },
        'Hit Enter to refresh. CTRL+C to quite',
      );
      break;
    }
    case 'step-too-soon': {
      console.log(`Go through onboarding steps at ${config.baseURL}/onboarding first.`);
      await waitForKeyPress(
        {
          Enter: retryFn,
          c: undefined,
          C: undefined,
        },
        'Hit Enter to refresh. Hit "c" to continue anyway. CTRL+C to quit',
      );

      break;
    }
    case 'error': {
      console.error('An issue occured while fetching the onboarding status');
      console.error(onboardingCheck.error);

      await waitForKeyPress({ Enter: retryFn }, 'Hit Enter to retry. CTRL+C to quit.');
      break;
    }
    default: {
      program.error('Invariant');
    }
  }
}

async function handleStep1(opts: BaseCommandOptions, userInfo: UserInfo) {
  await handleGetOnboardingResponse(opts.client, userInfo);
}

async function fetchUserInfo(client: BaseCommandOptions['client']) {
  const response = await client.platform.whoAmI(
    {},
    {
      headers: getBaseHeaders(),
    },
  );

  switch (response.response?.code) {
    case EnumStatusCode.OK: {
      return {
        userInfo: {
          userEmail: response.userEmail,
          organizationName: response.organizationName,
        },
        error: null,
      };
    }
    default: {
      return {
        userInfo: null,
        error: new Error(response.response?.details ?? 'An unknown error occured'),
      };
    }
  }
}

async function getUserInfo(client: BaseCommandOptions['client']) {
  const spinner = ora('Retrieving information about you…').start();
  const { userInfo, error } = await fetchUserInfo(client);

  if (error) {
    spinner.fail(error.message);
    program.error(error.message);
  }

  spinner.succeed(
    `You are signed in as ${pc.bold(userInfo.userEmail)} in organization ${pc.bold(userInfo.organizationName)}.`,
  );

  return userInfo;
}

export default (opts: BaseCommandOptions) => {
  const command = new Command('start');
  command.description('Launches interactive tutorial');

  command.action(async () => {
    clearScreen();
    printHello();

    const userInfo = await getUserInfo(opts.client);
    await printAccountDisclaimer();

    await handleStep1(opts, userInfo);
  });

  return command;
};
