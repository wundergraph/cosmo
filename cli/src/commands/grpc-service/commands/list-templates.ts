import { Command } from 'commander';
import pc from 'picocolors';
import Spinner from 'ora';
import { Octokit } from '@octokit/rest';
import { BaseCommandOptions } from '../../../core/types/types.js';

export async function fetchAvailableTemplates(): Promise<string[]> {
  const octokit = new Octokit();
  const owner = 'wundergraph';
  const repo = 'cosmo-templates';
  const path = 'grpc-service';

  try {
    const res = await octokit.repos.getContent({ owner, repo, path });
    if (Array.isArray(res.data)) {
      return res.data.filter((item: any) => item.type === 'dir').map((item: any) => item.name);
    }
  } catch {
    console.error('Error listing templates from https://github.com/wundergraph/cosmo-templates/');
  }
  return [];
}

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
        console.error(error);
      }
    });
  return command;
};
