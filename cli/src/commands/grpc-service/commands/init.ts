import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import Spinner from 'ora';
import pc from 'picocolors';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { fetchAvailableTemplates, downloadAndExtractTemplate } from '../utils/github-client.js';

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
        try {
          await downloadAndExtractTemplate(template, outputDir, spinner);
        } catch (error) {
          if (error instanceof Error && error.message.includes('Extracted template directory is empty')) {
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
          throw error;
        }
        spinner.succeed(pc.green(`gRPC service scaffolded in ${outputDir}`));
        console.log('');
        console.log(
          `  Checkout the ${pc.bold(pc.italic('README.md'))} file for instructions on how to use your service.`,
        );
        console.log('');
      } catch (error) {
        spinner.fail(pc.red('Failed to scaffold gRPC service'));
        program.error(`Failed to scaffold gRPC service: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  return command;
};
