import { existsSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import Spinner from 'ora';
import degit from 'degit';
import pc from 'picocolors';
import fetch from 'node-fetch';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { fetchAvailableTemplates } from './list-templates.js';

async function checkTemplateExists(template: string): Promise<boolean> {
  const url = `https://api.github.com/repos/wundergraph/cosmo-grpc-templates/contents/${template}`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github.v3+json' } });
  if (res.status === 200) {
    const data: any = await res.json();
    return Array.isArray(data); // Should be an array if it's a directory
  }
  return false;
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
    const repo = `wundergraph/cosmo-grpc-templates/${template}`;

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
        console.log(pc.red('No templates found in wundergraph/cosmo-grpc-templates.'));
      }
      program.error(
        `Template '${template}' does not exist in wundergraph/cosmo-grpc-templates. Please check the template name and try again.`,
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
      const emitter = degit(repo, { force: true, verbose: false });
      emitter.on('info', (info: any) => {
        spinner.text = info.message;
      });
      await emitter.clone(outputDir);
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
