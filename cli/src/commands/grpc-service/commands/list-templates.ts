import { Command } from 'commander';
import pc from 'picocolors';
import fetch from 'node-fetch';
import Spinner from 'ora';
import { BaseCommandOptions } from '../../../core/types/types.js';

export async function fetchAvailableTemplates(): Promise<string[]> {
  const url = 'https://api.github.com/repos/wundergraph/cosmo-grpc-templates/contents';
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github.v3+json' } });
  if (res.status === 200) {
    const data = (await res.json()) as any[];
    // Only return directories
    return data.filter((item: any) => item.type === 'dir').map((item: any) => item.name);
  }
  return [];
}

export default (_opts: BaseCommandOptions) => {
  const command = new Command('list-templates');
  command.description('List all available gRPC service templates');
  command.action(async () => {
    const spinner = Spinner('Fetching available templates...').start();
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
  });
  return command;
};
