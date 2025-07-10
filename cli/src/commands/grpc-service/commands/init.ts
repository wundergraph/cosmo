import { existsSync, readdirSync, mkdirSync } from 'node:fs';
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
  const octokit = new Octokit({
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  });
  const owner = 'wundergraph';
  const repo = 'cosmo-templates';
  const path = `grpc-service/${template}`;
  try {
    const res = await octokit.repos.getContent({ owner, repo, path });
    // If it's a directory, res.data will be an array
    return Array.isArray(res.data);
  } catch {
    return false;
  }
}

async function downloadAndExtractTemplate(template: string, outputDir: string, spinner: any) {
  const octokit = new Octokit();
  const owner = 'wundergraph';
  const repo = 'cosmo-templates';
  const ref = 'main'; // You may want to make this configurable
  const tempTarPath = join(os.tmpdir(), `cosmo-templates-${Date.now()}.tar.gz`);
  const tempExtractDir = join(os.tmpdir(), `cosmo-templates-extract-${Date.now()}`);

  let topLevelDir = '';
  try {
    await fs.ensureDir(tempExtractDir);

    spinner.text = 'Downloading template from GitHub...';
    let response;
    try {
      response = await octokit.repos.downloadTarballArchive({ owner, repo, ref });
    } catch (err: any) {
      throw new Error(`Failed to download template tarball from GitHub: ${err.message || err}`);
    }
    if (response.data instanceof ArrayBuffer) {
      try {
        await fs.writeFile(tempTarPath, new Uint8Array(Buffer.from(response.data)));
      } catch (err: any) {
        throw new Error(`Failed to write tarball to disk: ${err.message || err}`);
      }
    } else {
      throw new TypeError('Unexpected tarball response type');
    }

    spinner.text = 'Extracting template files...';
    try {
      await t({
        file: tempTarPath,
        onentry: (entry: { path: string }) => {
          if (!topLevelDir && entry.path.includes('/')) {
            topLevelDir = entry.path.split('/')[0];
          }
        },
      });
    } catch (err: any) {
      throw new Error(`Failed to inspect tarball for top-level directory: ${err.message || err}`);
    }
    const templatePathInTar = `${topLevelDir}/grpc-service/${template}`;
    let extracted = false;
    try {
      await extract({
        file: tempTarPath,
        cwd: tempExtractDir,
        filter: (p: string) => p.startsWith(templatePathInTar + '/'),
        strip: templatePathInTar.split('/').length,
      });
      // Validate extraction
      const extractedTemplateDir = join(tempExtractDir);
      const files = await fs.readdir(extractedTemplateDir);
      if (!files || files.length === 0) {
        throw new Error('Extracted template directory is empty. The template may not exist or is misconfigured.');
      }
      extracted = true;
    } catch (err: any) {
      throw new Error(`Failed to extract template files: ${err.message || err}`);
    }

    // Copy extracted files to outputDir
    await fs.copy(tempExtractDir, outputDir, { overwrite: true }).catch((err: any) => {
      throw new Error(`Failed to copy extracted files to output directory: ${err.message || err}`);
    });
  } catch (error: any) {
    spinner.fail(pc.red('Error during template extraction.'));
    throw error;
  } finally {
    // Cleanup
    await fs.remove(tempTarPath).catch();
    await fs.remove(tempExtractDir).catch();
  }
}

export default (opts: BaseCommandOptions) => {
  const command = new Command();
  command
    .name('init')
    .description('Scaffold a new gRPC service project from a template')
    .option('-t, --template <template>', 'Template to use', 'typescript-connect-rpc-fastify')
    .option('-d, --directory <directory>', 'Output directory', '.')
    .action(async (options: { template: string; directory: string }) => {
      const spinner = Spinner();
      const template = options.template || 'typescript-connect-rpc-fastify';
      // Validate template name to prevent path traversal
      if (!/^[\w-]+$/.test(template)) {
        program.error(
          `Invalid template name '${template}'. Template names can only contain letters, numbers, hyphens, and underscores.`,
        );
      }
      const outputDir = resolve(process.cwd(), options.directory || '.');

      spinner.start(`Checking if template '${template}' exists...`);
      const templateExists = await checkTemplateExists(template);
      if (!templateExists) {
        spinner.start('Fetching available templates...');
        const templates = await fetchAvailableTemplates();
        spinner.stop();
        if (templates.length > 0) {
          console.log(pc.yellow('Available templates:'));
          for (const t of templates) {
            console.log(`  - ${t}`);
          }
          console.log('');
          console.log(
            `\n${pc.yellow('To use a template, run:')}\n  wgc grpc-service init --template ${templates[0]} --directory ./output\n`,
          );
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
          mkdirSync(outputDir, { recursive: true });
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
