import pc from 'picocolors';
import ora from 'ora';

import { Command, program } from 'commander';
import type {
  /* eslint-disable-next-line camelcase */
  GetOnboardingResponse_Onboarding,
  WhoAmIResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb.js';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders, config } from '../../../core/config.js';
import { waitForKeyPress, rainbow } from '../../../utils.js';

type UserInfo = {
  userEmail: WhoAmIResponse['userEmail'];
  organizationName: WhoAmIResponse['organizationName'];
};

const demoGraphName = 'demo' as const;
const demoNamespace = 'default' as const;
const demoLabelMatcher = `graph=demo` as const;
const demoRouterPort = 3002 as const;

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

function resetLayout() {
  clearScreen();
  printLogo();
}

/* eslint-disable-next-line camelcase */
async function fetchFederatedGraph(client: BaseCommandOptions['client'], id: GetOnboardingResponse_Onboarding['id']) {
  const { response, graph } = await client.platform.getFederatedGraphById(
    {
      id,
    },
    {
      headers: getBaseHeaders(),
    },
  );

  switch (response?.code) {
    case EnumStatusCode.OK: {
      return { graph, error: null };
    }
    default: {
      return {
        graph: null,
        error: new Error(response?.details ?? 'An unknown error occured'),
      };
    }
  }
}

async function createFederatedGraph(
  client: BaseCommandOptions['client'],
  options: {
    name: string;
    namespace: string;
    port: number;
    labelMatcher: string;
  },
) {
  const routingUrl = new URL('http://localhost');
  routingUrl.port = String(options.port);

  const { response, deploymentErrors, compositionErrors } = await client.platform.createFederatedGraph(
    {
      name: options.name,
      namespace: options.namespace,
      routingUrl: routingUrl.toString(),
      labelMatchers: [options.labelMatcher],
      isDemo: true,
    },
    {
      headers: getBaseHeaders(),
    },
  );

  switch (response?.code) {
    case EnumStatusCode.OK: {
      return { error: null };
    }
    default: {
      if (deploymentErrors.length > 0 || compositionErrors.length > 0) {
        return {
          error: new Error(
            `Failed to create federated graph ${options.name}. Reason: ${deploymentErrors.length} deployment errors, ${compositionErrors.length} composition errors.\n${response?.details}`,
          ),
        };
      }

      return {
        error: new Error(response?.details ?? 'An unknown error occured'),
      };
    }
  }
}

async function handleCreateFederatedGraphResponse(
  client: BaseCommandOptions['client'],
  /* eslint-disable-next-line camelcase */
  onboarding: GetOnboardingResponse_Onboarding,
) {
  function retryFn() {
    resetLayout();
    return handleCreateFederatedGraphResponse(client, onboarding);
  }

  if (onboarding.federatedGraphId) {
    const spinner = ora().start();
    const federatedGraphResponse = await fetchFederatedGraph(client, onboarding.federatedGraphId);

    if (federatedGraphResponse.error) {
      spinner.fail(`Failed to retrieve graph information ${federatedGraphResponse.error}`);
      await waitForKeyPress(
        {
          r: retryFn,
          R: retryFn,
        },
        'Hit [r] to refresh. CTRL+C to quit',
      );
      return;
    }

    spinner.succeed(`Federated graph ${pc.bold(federatedGraphResponse.graph?.name)} was already created.`);

    return {
      status: 'federated-graph-exists',
    } as const;
  } else {
    const spinner = ora().start();
    const createGraphResponse = await createFederatedGraph(client, {
      name: demoGraphName,
      namespace: demoNamespace,
      port: demoRouterPort,
      labelMatcher: demoLabelMatcher,
    });

    if (createGraphResponse.error) {
      spinner.fail(createGraphResponse.error.message);

      await waitForKeyPress(
        {
          r: retryFn,
          R: retryFn,
        },
        'Hit [r] to refresh. CTRL+C to quit',
      );
      return;
    }

    spinner.succeed(`Federated graph succesfully created.`);

    return {
      status: 'federated-graph-created',
    } as const;
  }
}

async function handleStep2(
  opts: BaseCommandOptions,
  onboardingCheck: {
    status: 'ok' | 'step-too-soon';
    /* eslint-disable-next-line camelcase */
    onboarding: GetOnboardingResponse_Onboarding;
  },
) {
  resetLayout();
  return await handleCreateFederatedGraphResponse(opts.client, onboardingCheck.onboarding);
}

async function checkExistingOnboarding(client: BaseCommandOptions['client']) {
  const { response, onboarding } = await client.platform.getOnboarding(
    {},
    {
      headers: getBaseHeaders(),
    },
  );

  switch (response?.code) {
    case EnumStatusCode.OK: {
      if (!onboarding) {
        return { status: 'not-initiated' } as const;
      }

      if (onboarding && onboarding.finishedAt) {
        return {
          status: 'finished',
        } as const;
      }

      if (onboarding && onboarding.step < 2) {
        return {
          status: 'step-too-soon',
          onboarding,
        } as const;
      }

      return {
        status: 'ok',
        onboarding,
      } as const;
    }
    default: {
      return {
        status: 'error',
        error: new Error(response?.details ?? 'Failed to fetch onboarding metadata.'),
      } as const;
    }
  }
}

async function handleGetOnboardingResponse(client: BaseCommandOptions['client'], userInfo: UserInfo) {
  const spinner = ora().start();
  const onboardingCheck = await checkExistingOnboarding(client);

  async function retryFn() {
    resetLayout();
    return await handleGetOnboardingResponse(client, userInfo);
  }

  switch (onboardingCheck.status) {
    case 'ok': {
      spinner.stop();
      return onboardingCheck;
    }
    case 'finished': {
      spinner.succeed(
        `You have finished the onboarding already. Restart it by visiting ${config.baseURL} and click the link in top banner.`,
      );
      break;
    }
    case 'not-initiated': {
      spinner.warn(`Please start onboarding at ${config.baseURL}/onboarding first.`);
      await waitForKeyPress(
        {
          r: retryFn,
          R: retryFn,
        },
        'Hit [r] to refresh. CTRL+C to quit',
      );
      break;
    }
    case 'step-too-soon': {
      spinner.warn(`Go through onboarding steps at ${config.baseURL}/onboarding first.`);
      await waitForKeyPress(
        {
          r: retryFn,
          R: retryFn,
          c: undefined,
          C: undefined,
        },
        'Hit [r] to refresh, [c] to continue anyway. CTRL+C to quit',
      );

      return onboardingCheck;
    }
    case 'error': {
      spinner.fail('An issue occured while fetching the onboarding status');
      console.error(onboardingCheck.error);

      await waitForKeyPress(
        {
          R: retryFn,
          r: retryFn,
        },
        'Hit [r] to retry. CTRL+C to quit.',
      );
      break;
    }
    default: {
      spinner.stop();
      program.error('Invariant');
    }
  }
}

async function handleStep1(opts: BaseCommandOptions, userInfo: UserInfo) {
  resetLayout();
  return await handleGetOnboardingResponse(opts.client, userInfo);
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

    const onboardingCheck = await handleStep1(opts, userInfo);

    if (!onboardingCheck) {
      return;
    }

    await handleStep2(opts, onboardingCheck);
  });

  return command;
};
