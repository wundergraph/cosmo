import { Command, program } from 'commander';
import pc from 'picocolors';
import Spinner, { type Ora } from 'ora';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { fetchAvailableTemplates } from '../utils/github-client.js';

export default (_opts: BaseCommandOptions) => {
  const command = new Command();
  command
    .name('list-templates')
    .description('List all available gRPC service templates')
    .action(async () => {
      const spinner: Ora = Spinner('Fetching available templates...').start();
      try {
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
      } catch (error) {
        spinner.fail('Failed to fetch templates');
        const errorMessage = error instanceof Error ? error.message : String(error);
        program.error(`Failed to fetch templates: ${errorMessage}`);
      }
    });
  return command;
};

export { fetchAvailableTemplates } from '../utils/github-client.js';
