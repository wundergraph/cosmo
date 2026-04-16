import pc from 'picocolors';
import { program } from 'commander';
import type { FederatedGraph, Subgraph, WhoAmIResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { config } from '../../core/config.js';
import { createRouterToken, deleteRouterToken } from '../../core/router-token.js';
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
  runRouterContainer,
  updateScreenWithUserInfo,
  demoSpinner,
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

  const spinner = demoSpinner().start();
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

  const spinner = demoSpinner(`Removing federated graph ${pc.bold(graphData.graph.name)}…`).start();
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

  const federatedGraphSpinner = demoSpinner().start();
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
    logPath,
  }: {
    onboarding: { finishedAt?: string };
    userInfo: UserInfo;
    supportDir: string;
    signal: AbortSignal;
    logPath: string;
  },
) {
  function retryFn() {
    resetScreen(userInfo);
    return handleStep2(opts, { onboarding, userInfo, supportDir, signal, logPath });
  }

  const graphData = await handleGetFederatedGraphResponse(opts.client, {
    onboarding,
    userInfo,
  });

  const graph = graphData?.graph;
  const subgraphs = graphData?.subgraphs ?? [];
  if (graph) {
    let deleted = false;
    const cleanupFn = async () => {
      await cleanupFederatedGraph(opts.client, {
        graphData: { graph, subgraphs },
        userInfo,
      });
      deleted = true;
    };
    await waitForKeyPress(
      {
        Enter: () => undefined,
        d: cleanupFn,
        D: cleanupFn,
      },
      'Hit [ENTER] to continue or [d] to delete the federated graph and its subgraphs to start over. CTRL+C to quit.',
    );
    if (deleted) {
      console.log(pc.yellow('\nPlease restart the demo command to continue.\n'));
      process.exit(0);
    }
    return { routingUrl: graph.routingURL };
  }

  await handleCreateFederatedGraphResponse(opts.client, {
    onboarding,
    userInfo,
  });

  const routingUrl = new URL('graphql', 'http://localhost');
  routingUrl.port = String(config.demoRouterPort);

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

  return { routingUrl: routingUrl.toString() };
}

async function handleStep3(
  opts: BaseCommandOptions,
  {
    userInfo,
    routerBaseUrl,
    signal,
    logPath,
  }: {
    userInfo: UserInfo;
    routerBaseUrl: string;
    signal: AbortSignal;
    logPath: string;
  },
) {
  function retryFn() {
    resetScreen(userInfo);
    return handleStep3(opts, { userInfo, routerBaseUrl, signal, logPath });
  }

  const tokenParams = {
    client: opts.client,
    tokenName: config.demoRouterTokenName,
    graphName: config.demoGraphName,
    namespace: config.demoNamespace,
  };

  // Delete existing token first (idempotent — no error if missing)
  const deleteResult = await deleteRouterToken(tokenParams);
  if (deleteResult.error) {
    console.error(`Failed to clean up existing router token: ${deleteResult.error.message}`);
    await waitForKeyPress({ r: retryFn, R: retryFn }, 'Hit [r] to retry. CTRL+C to quit.');
    return;
  }

  const spinner = demoSpinner('Generating router token…').start();
  const createResult = await createRouterToken(tokenParams);

  if (createResult.error) {
    spinner.fail(`Failed to generate router token: ${createResult.error.message}`);
    await waitForKeyPress({ r: retryFn, R: retryFn }, 'Hit [r] to retry. CTRL+C to quit.');
    return;
  }

  spinner.succeed('Router token generated.');
  console.log(`  ${pc.bold(createResult.token)}`);

  const sampleQuery = JSON.stringify({
    query: `query GetProductWithReviews($id: ID!) { product(id: $id) { id title price { currency amount } reviews { id author rating contents } } }`,
    variables: { id: 'product-1' },
  });

  async function fireSampleQuery() {
    const querySpinner = demoSpinner('Sending sample query…').start();
    try {
      const res = await fetch(`${routerBaseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'GraphQL-Client-Name': 'wgc',
        },
        body: sampleQuery,
      });
      const body = await res.json();
      querySpinner.succeed('Sample query response:');
      console.log(pc.dim(JSON.stringify(body, null, 2)));
    } catch (err) {
      querySpinner.fail(`Sample query failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    showQueryPrompt();
  }

  function showQueryPrompt() {
    waitForKeyPress(
      { r: fireSampleQuery, R: fireSampleQuery },
      'Hit [r] to send a sample query. CTRL+C to stop the router.',
    );
  }

  const routerResult = await runRouterContainer({
    routerToken: createResult.token!,
    routerBaseUrl,
    signal,
    logPath,
  });

  showQueryPrompt();

  if (routerResult.error) {
    console.error(`\nRouter exited with error: ${routerResult.error.message}`);
    await waitForKeyPress({ r: retryFn, R: retryFn }, 'Hit [r] to retry. CTRL+C to quit.');
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
  const spinner = demoSpinner('Retrieving information about you…').start();
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

      const logPath = getDemoLogPath();

      const step2Result = await handleStep2(opts, {
        onboarding: onboardingCheck,
        userInfo,
        supportDir,
        signal: controller.signal,
        logPath,
      });

      if (!step2Result) {
        return;
      }

      const routerBaseUrl = new URL(step2Result.routingUrl).origin;
      await handleStep3(opts, { userInfo, routerBaseUrl, signal: controller.signal, logPath });
    } finally {
      // no-op
    }
  };
}
