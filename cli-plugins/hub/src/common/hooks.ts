import { readFile } from 'node:fs/promises';
import { errorMessage } from '@wundergraph/wgc-plugin-sdk';
import type { CommandHooks, HookContribution } from '@wundergraph/wgc-plugin-sdk';
import { subgraphCheckAnswer, subgraphPublishAnswer } from './contract.js';
import type { SubgraphCheckAnswer } from './contract.js';
import { connectHub, hubGitlabTokenVariable } from './hub.js';
import type { HubDependencies } from './runtime.js';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** What the pull request sandbox Hub updated with the checked SDL adds to `subgraph check`'s verdict. */
const checkContribution = (answer: SubgraphCheckAnswer): HookContribution => {
  if (answer.pullRequest === null) {
    return { verdict: 'info', summary: 'this run belongs to no pull request, so no sandbox was updated' };
  }

  const { pullRequest, sandbox } = answer;
  const total = sandbox.passed + sandbox.failed;
  const details = [`pull request #${pullRequest.number}: ${pullRequest.url}`, `endpoint: ${sandbox.endpointUrl}`];
  const data = {
    pullRequest,
    sandbox: { name: sandbox.name, endpointUrl: sandbox.endpointUrl, passed: sandbox.passed, failed: sandbox.failed },
    problem: sandbox.problem,
  };

  if (sandbox.problem !== null) {
    return {
      verdict: 'failed',
      summary: `sandbox ${sandbox.name}: ${sandbox.problem.message}`,
      details: sandbox.problem.remediation === null ? details : [sandbox.problem.remediation, ...details],
      url: sandbox.hubUrl,
      data,
    };
  }
  if (sandbox.failed > 0) {
    return {
      verdict: 'failed',
      summary: `${sandbox.failed} of ${plural(total, 'operation')} failed in sandbox ${sandbox.name}`,
      details,
      url: sandbox.hubUrl,
      data,
    };
  }
  return {
    verdict: 'passed',
    summary: `sandbox ${sandbox.name} is up to date${total > 0 ? `, ${sandbox.passed} of ${plural(total, 'operation')} passed` : ''}`,
    details,
    url: sandbox.hubUrl,
    data,
  };
};

/**
 * In a CI job, reports `wgc subgraph check` to Hub, which puts the checked SDL and Cosmo's verdict into the pull
 * request's sandbox, and makes Hub follow `wgc subgraph publish`. Both use the job's OIDC token; outside CI they add
 * nothing.
 */
export const registerHubHooks = (hooks: CommandHooks, { context, runtime }: HubDependencies): void => {
  const audience = runtime.env.HUB_OIDC_AUDIENCE || 'hub';

  const inCi = async (): Promise<boolean> => {
    const token = await context.credentials.ciOidcToken({ audience, gitlabTokenVariable: hubGitlabTokenVariable });
    return token.success && token.data !== undefined;
  };

  hooks.after('subgraph check', async ({ input, result }) => {
    if (input.delete || input.schemaPath === undefined || !(await inCi())) {
      return undefined;
    }

    const sdl = await readFile(input.schemaPath, 'utf8');
    const answer = await connectHub(context, audience).postJson(
      'ci/subgraph-check',
      {
        subgraph: input.subgraph,
        namespace: input.namespace,
        sdl,
        cosmo: { ok: result.passed, url: result.checkUrl ?? null, problems: result.problems },
      },
      subgraphCheckAnswer,
    );
    if (!answer.success) {
      return { verdict: 'failed', summary: errorMessage(answer) };
    }
    return checkContribution(answer.data);
  });

  hooks.after('subgraph publish', async ({ input, result }) => {
    if (!result.published || !(await inCi())) {
      return undefined;
    }

    const answer = await connectHub(context, audience).postJson(
      'ci/subgraph-publish',
      { subgraph: input.subgraph, namespace: input.namespace },
      subgraphPublishAnswer,
    );
    if (!answer.success) {
      return { verdict: 'failed', summary: errorMessage(answer) };
    }
    const { graph, inSync } = answer.data;
    if (!inSync) {
      return {
        verdict: 'failed',
        summary: `${graph.slug} in Hub did not take the published schema; Cosmo's schema webhook has not reached Hub`,
        url: graph.hubUrl,
        data: { graph, inSync },
      };
    }
    return {
      verdict: 'passed',
      summary: `${graph.slug} in Hub has this schema`,
      url: graph.hubUrl,
      data: { graph, inSync },
    };
  });
};
