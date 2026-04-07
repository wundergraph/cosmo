import pc from 'picocolors';
import ora from 'ora';
import { program } from 'commander';
import type { FederatedGraph, Subgraph, WhoAmIResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { config } from '../../core/config.js';
import { BaseCommandOptions } from '../../core/types/types.js';
import { waitForKeyPress, rainbow } from '../../utils.js';
import type { UserInfo } from './types.js';
import {
  cleanUpFederatedGraph,
  createFederatedGraph,
  fetchFederatedGraphByName,
  fetchUserInfo,
  checkExistingOnboarding,
} from './api.js';
import {
  checkDockerReadiness,
  clearScreen,
  getDemoLogPath,
  prepareSupportingData,
  printLogo,
  publishAllPlugins,
  resetScreen,
  updateScreenWithUserInfo,
} from './util.js';

function printHello() {
  printLogo();
  console.log(
    `\nThank you for choosing ${rainbow('WunderGraph')} - The open-source solution to building, maintaining, and collaborating on GraphQL Federation at Scale.`,
  );
  console.log('This command will guide you through the inital setup to create your first federated graph.');
}

async function handleGetFederatedGraphResponse(
  client: BaseCommandOptions['client'],
  {
    onboarding,
    userInfo,
  }: {
    onboarding: {
      finishedAt?: string;
    };
    userInfo: UserInfo;
  },
) {
  function retryFn() {
    resetScreen(userInfo);
    return handleGetFederatedGraphResponse(client, {
      onboarding,
      userInfo,
    });
  }

  const spinner = ora().start();
  const getFederatedGraphResponse = await fetchFederatedGraphByName(client, {
    name: config.demoGraphName,
    namespace: config.demoNamespace,
  });

  if (getFederatedGraphResponse.error) {
    spinner.fail(`Failed to retrieve graph information ${getFederatedGraphResponse.error}`);
    return await waitForKeyPress(
      {
        r: retryFn,
        R: retryFn,
      },
      'Hit [r] to refresh. CTRL+C to quit',
    );
  }

  if (getFederatedGraphResponse.data?.graph) {
    spinner.succeed(`Federated graph ${pc.bold(getFederatedGraphResponse.data?.graph?.name)} exists.`);
  } else {
    spinner.stop();
  }

  return getFederatedGraphResponse.data;
}

async function cleanupFederatedGraph(
  client: BaseCommandOptions['client'],
  {
    graphData,
    userInfo,
  }: {
    graphData: {
      graph: FederatedGraph;
      subgraphs: Subgraph[];
    };
    userInfo: UserInfo;
  },
) {
  let deleted = false;

  function retryFn() {
    resetScreen(userInfo);
    cleanupFederatedGraph(client, { graphData, userInfo });
  }

  const spinner = ora().start(`Removing federated graph ${pc.bold(graphData.graph.name)}…`);
  const deleteResponse = await cleanUpFederatedGraph(client, graphData);

  if (deleteResponse.error) {
    deleted = false;
    spinner.fail(`Removing federated graph ${graphData.graph.name} failed.`);
    console.error(deleteResponse.error.message);

    return await waitForKeyPress(
      {
        Enter: () => undefined,
        r: retryFn,
        R: retryFn,
      },
      `Failed to delete the federated graph ${pc.bold(graphData.graph.name)}. [ENTER] to continue, [r] to retry. CTRL+C to quit.`,
    );
  } else {
    deleted = true;
  }

  if (deleted) {
    spinner.succeed(`Federated graph ${pc.bold(graphData.graph.name)} removed.`);
  }
}

async function handleCreateFederatedGraphResponse(
  client: BaseCommandOptions['client'],
  {
    onboarding,
    userInfo,
  }: {
    onboarding: {
      finishedAt?: string;
    };
    userInfo: UserInfo;
  },
) {
  function retryFn() {
    resetScreen(userInfo);
    handleCreateFederatedGraphResponse(client, { onboarding, userInfo });
  }

  const routingUrl = new URL('graphql', 'http://localhost');
  routingUrl.port = String(config.demoRouterPort);

  const federatedGraphSpinner = ora().start();
  const createGraphResponse = await createFederatedGraph(client, {
    name: config.demoGraphName,
    namespace: config.demoNamespace,
    labelMatcher: config.demoLabelMatcher,
    routingUrl,
  });

  if (createGraphResponse.error) {
    federatedGraphSpinner.fail(createGraphResponse.error.message);

    await waitForKeyPress(
      {
        r: retryFn,
        R: retryFn,
      },
      'Hit [r] to refresh. CTRL+C to quit',
    );
    return;
  }

  federatedGraphSpinner.succeed(`Federated graph ${pc.bold('demo')} succesfully created.`);
}

async function handleStep2(
  opts: BaseCommandOptions,
  {
    onboarding,
    userInfo,
    supportDir,
    signal,
  }: {
    onboarding: { finishedAt?: string };
    userInfo: UserInfo;
    supportDir: string;
    signal: AbortSignal;
  },
) {
  function retryFn() {
    resetScreen(userInfo);
    return handleStep2(opts, { onboarding, userInfo, supportDir, signal });
  }

  const graphData = await handleGetFederatedGraphResponse(opts.client, {
    onboarding,
    userInfo,
  });

  const graph = graphData?.graph;
  const subgraphs = graphData?.subgraphs ?? [];
  if (graph) {
    const cleanupFn = async () =>
      await cleanupFederatedGraph(opts.client, {
        graphData: { graph, subgraphs },
        userInfo,
      });
    await waitForKeyPress(
      {
        Enter: () => undefined,
        d: cleanupFn,
        D: cleanupFn,
      },
      'Hit [ENTER] to continue or [d] to delete the federated graph and its subgraphs to start over. CTRL+C to quit.',
    );
    return;
  }

  await handleCreateFederatedGraphResponse(opts.client, {
    onboarding,
    userInfo,
  });

  const logPath = getDemoLogPath();
  console.log(`\nPublishing plugins… ${pc.dim(`(logs: ${logPath})`)}`);

  const publishResult = await publishAllPlugins({
    client: opts.client,
    supportDir,
    signal,
    logPath,
  });

  if (publishResult.error) {
    await waitForKeyPress(
      {
        r: retryFn,
        R: retryFn,
      },
      'Hit [r] to retry. CTRL+C to quit.',
    );
  }
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
  return await handleGetOnboardingResponse(opts.client, userInfo);
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
    const controller = new AbortController();
    const cleanup = () => controller.abort();
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    try {
      clearScreen();
      printHello();
      const supportDir = await prepareSupportingData();
      await checkDockerReadiness();
      const userInfo = await getUserInfo(opts.client);
      updateScreenWithUserInfo(userInfo);

      await waitForKeyPress(
        {
          Enter: () => undefined,
        },
        `It is recommended you run this command along the onboarding wizard at ${config.baseURL}/onboarding with the same account.\nPress ENTER to continue…`,
      );

      resetScreen(userInfo);

      const onboardingCheck = await handleStep1(opts, userInfo);

      if (!onboardingCheck) {
        return;
      }

      await handleStep2(opts, { onboarding: onboardingCheck, userInfo, supportDir, signal: controller.signal });
    } finally {
      process.off('SIGINT', cleanup);
      process.off('SIGTERM', cleanup);
    }
  };
}
