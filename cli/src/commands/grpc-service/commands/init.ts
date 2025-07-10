import { existsSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import { Command, program } from 'commander';
import { resolve, join } from 'pathe';
import Spinner from 'ora';
import { Octokit } from '@octokit/rest';
import { extract, t } from 'tar';
import fs from 'fs-extra';
import pc from 'picocolors';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { fetchAvailableTemplates } from './list-templates.js';

async function checkTemplateExists(template: string): Promise<boolean> {
  const octokit = new Octokit();
  const owner = 'wundergraph';
  const repo = 'cosmo-templates';
  const path = `grpc-service/${template}`;
  try {
    const res = await octokit.repos.getContent({ owner, repo, path });
    // If it's a directory, res.data will be an array
    return Array.isArray(res.data);
  } catch (error: any) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
}

async function downloadAndExtractTemplate(template: string, outputDir: string, spinner: any) {
  const octokit = new Octokit();
  const owner = 'wundergraph';
  const repo = 'cosmo-templates';
  const ref = 'main'; // You may want to make this configurable
  const tempTarPath = join(os.tmpdir(), `cosmo-templates-${Date.now()}.tar.gz`);
  const tempExtractDir = join(os.tmpdir(), `cosmo-templates-extract-${Date.now()}`);
  await fs.ensureDir(tempExtractDir);

  spinner.text = 'Downloading template from GitHub...';
  const response = await octokit.repos.downloadTarballArchive({ owner, repo, ref });
  if (response.data instanceof ArrayBuffer) {
    await fs.writeFile(tempTarPath, new Uint8Array(Buffer.from(response.data)));
  } else {
    throw new TypeError('Unexpected tarball response type');
  }

  spinner.text = 'Extracting template files...';
  // The tarball will have a top-level directory like cosmo-templates-<sha>/grpc-service/<template>/
  // We want to extract only grpc-service/<template> and copy its contents to outputDir
  let topLevelDir = '';
  await t({
    file: tempTarPath,
    onentry: (entry: { path: string }) => {
      if (!topLevelDir && entry.path.includes('/')) {
        topLevelDir = entry.path.split('/')[0];
      }
    },
  });
  const templatePathInTar = `${topLevelDir}/grpc-service/${template}`;
  await extract({
    file: tempTarPath,
    cwd: tempExtractDir,
    filter: (p: string) => p.startsWith(templatePathInTar + '/'),
    strip: templatePathInTar.split('/').length,
  });

  // Copy extracted files to outputDir
  await fs.copy(tempExtractDir, outputDir, { overwrite: true });

  // Cleanup
  await fs.remove(tempTarPath);
  await fs.remove(tempExtractDir);
}

export default (opts: BaseCommandOptions) => {
  const command = new Command('init');
  command.description('Scaffold a new gRPC service project from a template');
  command.option('-t, --template <template>', 'Template to use', 'typescript-connect-rpc-fastify');
  command.option('-d, --directory <directory>', 'Output directory', '.');
  command.action(async (options) => {
    const spinner = Spinner();
    const template = options.template || 'typescript-connect-rpc-fastify';
    const outputDir = resolve(process.cwd(), options.directory || '.');

    spinner.start(`Checking if template '${template}' exists...`);
    const exists = await checkTemplateExists(template);
    if (!exists) {
      spinner.start('Fetching available templates...');
      const templates = await fetchAvailableTemplates();
      spinner.stop();
      if (templates.length > 0) {
        console.log(pc.yellow('Available templates:'));
        for (const t of templates) {
          console.log(`  - ${t}`);
        }
        console.log('');
        console.log(pc.yellow('To use a template, run:'));
        console.log(`  wgc grpc-service init --template ${templates[0]} --directory ./output`);
        console.log('');
      } else {
        console.log(pc.red('No templates found in wundergraph/cosmo-templates under grpc-service.'));
      }
      program.error(
        `Template '${template}' does not exist in wundergraph/cosmo-templates under grpc-service. Please check the template name and try again.`,
      );
    }

    spinner.text = `Scaffolding gRPC service using template '${template}'...`;

    try {
      if (existsSync(outputDir)) {
        const files = readdirSync(outputDir);
        if (files.length > 0) {
          spinner.fail(pc.red('Output directory is not empty.'));
          program.error(
            `The directory '${outputDir}' is not empty. Please use the --directory argument to specify an empty or new directory.`,
          );
        }
      } else {
        await mkdir(outputDir, { recursive: true });
      }
      await downloadAndExtractTemplate(template, outputDir, spinner);
      spinner.succeed(pc.green(`gRPC service scaffolded in ${outputDir}`));
      console.log('');
      console.log(
        `  Checkout the ${pc.bold(pc.italic('README.md'))} file for instructions on how to use your service.`,
      );
      console.log('');
    } catch (error: any) {
      spinner.fail(pc.red('Failed to scaffold gRPC service'));
      program.error(error.message || String(error));
    }
  });
  return command;
};
