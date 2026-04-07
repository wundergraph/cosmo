import pc from 'picocolors';
import ora from 'ora';
import { program } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { config } from '../../core/config.js';
import { waitForKeyPress, rainbow } from '../../utils.js';
import { fetchUserInfo, checkExistingOnboarding } from './api.js';
import type { UserInfo } from './types.js';
import { clearScreen, prepareSupportingData, printLogo, resetScreen, updateScreenWithUserInfo } from './util.js';

function printHello() {
  printLogo();
  console.log(
    `\nThank you for choosing ${rainbow('WunderGraph')} - The open-source solution to building, maintaining, and collaborating on GraphQL Federation at Scale.`,
  );
  console.log('This command will guide you through the inital setup to create your first federated graph.');
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
    case 'not-allowed': {
      program.error('Only organization owners can trigger onboarding.');

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

async function getUserInfo(client: BaseCommandOptions['client']) {
  const spinner = ora('Retrieving information about you…').start();
  const { userInfo, error } = await fetchUserInfo(client);

  if (error) {
    spinner.fail(error.message);
    program.error(error.message);
  } else if (!userInfo) {
    spinner.fail('Could not retrieve information about your account.');
    program.error('Failed to retrieve user information.');
  }

  spinner.succeed(
    `You are signed in as ${pc.bold(userInfo.userEmail)} in organization ${pc.bold(userInfo.organizationName)}.`,
  );

  return userInfo;
}

export default function (opts: BaseCommandOptions) {
  return async function handleCommand() {
    clearScreen();
    printHello();
    await prepareSupportingData();
    const userInfo = await getUserInfo(opts.client);
    updateScreenWithUserInfo(userInfo);

    await waitForKeyPress(
      {
        Enter: () => undefined,
      },
      `It is recommended you run this command along the onboarding wizard at ${config.baseURL}/onboarding with the same account.\nPress ENTER to continue…`,
    );

    resetScreen(userInfo);

    await handleStep1(opts, userInfo);
  };
}
