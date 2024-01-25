import { writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { join } from 'pathe';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { baseHeaders } from '../../../../../core/config.js';
import program from '../../../../index.js';

type OutputFile = {
  id: string;
  name: string;
  token: string;
  createdAt: string;
}[];

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists router tokens of a federated graph.');
  command.argument('<name>', 'The name of the federated graph.');
  command.option('-ns, --namespace [string]', 'The namespace of the federated graph.');
  command.option('-o, --out [string]', 'Destination file for the json output.');
  command.option('-r, --raw', 'Prints to the console in json format instead of table');
  command.action(async (name, options) => {
    const resp = await opts.client.platform.getRouterTokens(
      {
        fedGraphName: name,
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      console.log(pc.red(resp.response?.details));
      program.error(pc.red('Could not fetch the router tokens of a federated graph.'));
    }

    if (resp.tokens.length === 0) {
      console.log('No router tokens of the federated graph found');
      process.exit(0);
    }

    if (options.out) {
      const output = resp.tokens.map(
        (g) =>
          ({
            id: g.id,
            name: g.name,
            token: g.token,
            createdAt: g.createdAt,
          }) as OutputFile[number],
      );
      await writeFile(join(process.cwd(), options.out), JSON.stringify(output));
      process.exit(0);
    }

    if (options.raw) {
      console.log(resp.tokens);
      process.exit(0);
    }

    const tokensTable = new Table({
      head: [pc.bold(pc.white('NAME')), pc.bold(pc.white('TOKEN')), pc.bold(pc.white('CREATED_AT'))],
      colWidths: [25, 70, 40],
      wordWrap: true,
      wrapOnWordBoundary: false,
    });

    for (const token of resp.tokens) {
      tokensTable.push([token.name, token.token, token.createdAt]);
    }
    console.log(tokensTable.toString());
  });

  return command;
};
