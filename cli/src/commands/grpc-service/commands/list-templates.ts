import { Command, program } from 'commander';
import pc from 'picocolors';
import Spinner from 'ora';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { fetchAvailableTemplates } from '../utils/github-client.js';

export default (_opts: BaseCommandOptions) => {
  const command = new Command();
  command
    .name('list-templates')
    .description('List all available gRPC service templates')
    .action(async () => {
      const spinner = Spinner('Fetching available templates...').start();
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
        program.error(`Failed to fetch templates: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  return command;
};
