import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import { Octokit } from '@octokit/rest';
import { join } from 'pathe';
import { type Ora } from 'ora';
import { extract, t } from 'tar';
import fs from 'fs-extra';
import pc from 'picocolors';

export const GITHUB_CONFIG = {
  owner: 'wundergraph',
  repo: 'cosmo-templates',
  ref: 'main',
  grpcServicePath: 'grpc-service',
} as const;

export function createGitHubClient(): Octokit {
  return new Octokit({
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  });
}

export async function fetchAvailableTemplates(): Promise<string[]> {
  const octokit = createGitHubClient();
  const { owner, repo, grpcServicePath } = GITHUB_CONFIG;

  try {
    const res = await octokit.repos.getContent({
      owner,
      repo,
      path: grpcServicePath,
    });

    if (Array.isArray(res.data)) {
      return res.data.filter((item) => item.type === 'dir').map((item) => item.name);
    }
  } catch (error) {
    throw new Error(`Failed to fetch templates from GitHub: ${error instanceof Error ? error.message : String(error)}`);
  }

  return [];
}

export async function downloadAndExtractTemplate(template: string, outputDir: string, spinner: Ora) {
  const octokit = createGitHubClient();
  const { owner, repo, ref, grpcServicePath } = GITHUB_CONFIG;
  const tempTarPath = join(os.tmpdir(), `cosmo-templates-${Date.now()}.tar.gz`);
  const tempExtractDir = join(os.tmpdir(), `cosmo-templates-extract-${Date.now()}`);

  let topLevelDir = '';
  try {
    await fs.ensureDir(tempExtractDir);

    spinner.text = 'Downloading template from GitHub...';
    const response = await octokit.repos.downloadTarballArchive({ owner, repo, ref });

    if (!(response.data instanceof ArrayBuffer)) {
      throw new TypeError('Unexpected tarball response type');
    }

    await fs.writeFile(tempTarPath, new Uint8Array(Buffer.from(response.data)));

    spinner.text = 'Extracting template files...';
    await t({
      file: tempTarPath,
      onentry: (entry: { path: string }) => {
        if (!topLevelDir && entry.path.includes('/')) {
          topLevelDir = entry.path.split('/')[0];
        }
      },
    });

    const templatePathInTar = `${topLevelDir}/${grpcServicePath}/${template}`;
    await extract({
      file: tempTarPath,
      cwd: tempExtractDir,
      filter: (p: string) => p.startsWith(templatePathInTar + '/'),
      strip: templatePathInTar.split('/').length,
    });

    // Validate extraction
    const files = await fs.readdir(tempExtractDir);
    if (!files || files.length === 0) {
      throw new Error('Extracted template directory is empty. The template may not exist or is misconfigured.');
    }

    await fs.copy(tempExtractDir, outputDir, { overwrite: true });
  } catch (error) {
    spinner.fail(pc.red('Error during template extraction.'));
    throw error;
  } finally {
    // Cleanup
    await fs.remove(tempTarPath).catch();
    await fs.remove(tempExtractDir).catch();
  }
}
