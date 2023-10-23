import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { App } from 'octokit';
import { eq } from 'drizzle-orm';
import { CompositionError, GitInfo } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlainMessage } from '@bufbuild/protobuf';
import * as schema from '../../db/schema.js';

export class GitHubRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>, private githubApp: App) {}

  async verifyAppInstall(input: { code: string; installationId: number }): Promise<{ error?: string }> {
    try {
      const {
        authentication: { token },
      } = await this.githubApp.oauth.createToken({
        code: input.code,
      });

      const installation = await this.githubApp.octokit.rest.apps.getInstallation({
        installation_id: input.installationId,
      });

      // missing fields in the type, cast as any
      const account = installation.data.account as any;

      await this.db
        .insert(schema.gitInstallations)
        .values({
          providerName: 'github',
          providerInstallationId: installation.data.id,
          providerAccountId: account.id,
          slug: account.login,
          type: account.type === 'Organization' ? 'ORGANIZATION' : 'PERSONAL',
          oauthToken: token,
        })
        .execute();

      return {};
    } catch (e: any) {
      return { error: e.message };
    }
  }

  async deleteAppInstallation(installationId: number): Promise<{ error?: string }> {
    try {
      await this.db
        .delete(schema.gitInstallations)
        .where(eq(schema.gitInstallations.providerInstallationId, installationId))
        .execute();

      return {};
    } catch (e: any) {
      return { error: e.message };
    }
  }

  async createCommitCheck(input: {
    schemaCheckID: string;
    gitInfo: GitInfo;
    compositionErrors: PlainMessage<CompositionError>[];
    breakingChangesCount: number;
    subgraphName: string;
    composedGraphs: string[];
    organizationSlug: string;
    webBaseUrl: string;
  }): Promise<void> {
    const {
      schemaCheckID,
      gitInfo,
      compositionErrors,
      breakingChangesCount,
      subgraphName,
      organizationSlug,
      webBaseUrl,
      composedGraphs,
    } = input;

    const installation = await this.db.query.gitInstallations.findFirst({
      where: eq(schema.gitInstallations.providerAccountId, Number.parseInt(gitInfo.accountId)),
    });

    if (!installation) {
      return;
    }

    const app = await this.githubApp.getInstallationOctokit(installation.providerInstallationId);

    let title = 'Composed successfully';
    let conclusion: 'success' | 'failure' = 'success';

    if (compositionErrors.length > 0) {
      title = `Found ${compositionErrors.length} composition error`;
      if (compositionErrors.length > 1) {
        title += 's';
      }
      conclusion = 'failure';
    } else if (breakingChangesCount > 0) {
      title = `Found ${breakingChangesCount} breaking change`;
      if (breakingChangesCount > 1) {
        title += 's';
      }
      conclusion = 'failure';
    }

    let summary = `**Breaking Changes:** ${breakingChangesCount}\n\n**Composition Errors:** ${compositionErrors.length}`;
    let detailsUrl = `${webBaseUrl}/${organizationSlug}`;

    if (composedGraphs.length > 0) {
      const affectedGraphNames = composedGraphs.map((name) => ` - ${name}`).join('\n');
      summary += `\n\n**Affected Graphs:**\n${affectedGraphNames}`;
      detailsUrl += `/graph/${composedGraphs[0]}/checks/${schemaCheckID}`;
    }

    const {
      data: { id },
    } = await app.rest.checks.create({
      name: subgraphName,
      head_sha: gitInfo.commitSha,
      owner: gitInfo.ownerSlug,
      repo: gitInfo.repositorySlug,
      status: 'completed',
      details_url: detailsUrl,
      conclusion,
      output: {
        title,
        summary,
      },
    });

    await this.db
      .update(schema.schemaChecks)
      .set({
        ghDetails: {
          accountId: Number.parseInt(gitInfo.accountId),
          commitSha: gitInfo.commitSha,
          ownerSlug: gitInfo.ownerSlug,
          repositorySlug: gitInfo.repositorySlug,
          checkRunId: id,
        },
      })
      .where(eq(schema.schemaChecks.id, schemaCheckID))
      .execute();
  }

  async markCheckAsSuccess(input: {
    accountId: number;
    repositorySlug: string;
    ownerSlug: string;
    checkRunId: number;
  }) {
    const installation = await this.db.query.gitInstallations.findFirst({
      where: eq(schema.gitInstallations.providerAccountId, input.accountId),
    });

    if (!installation) {
      return;
    }

    const app = await this.githubApp.getInstallationOctokit(installation.providerInstallationId);

    await app.rest.checks.update({
      owner: input.ownerSlug,
      repo: input.repositorySlug,
      check_run_id: input.checkRunId,
      status: 'completed',
      conclusion: 'success',
    });
  }

  async isAppInstalledOnRepo(input: { accountId: string; ownerSlug: string; repoSlug: string }): Promise<boolean> {
    const installation = await this.db.query.gitInstallations.findFirst({
      where: eq(schema.gitInstallations.providerAccountId, Number.parseInt(input.accountId)),
    });

    if (!installation) {
      return false;
    }

    const app = await this.githubApp.getInstallationOctokit(installation.providerInstallationId);

    try {
      const repoInstallation = await app.rest.apps.getRepoInstallation({
        owner: input.ownerSlug,
        repo: input.repoSlug,
      });
      return !!repoInstallation.data;
    } catch (e: any) {
      if (e.status === 404) {
        return false;
      }
      throw e;
    }
  }
}
