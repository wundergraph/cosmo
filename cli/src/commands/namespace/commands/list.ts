import { writeFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import pc from 'picocolors';
import Table from 'cli-table3';
import { baseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

type OutputFile = {
  id: string;
  name: string;
}[];

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists all namespaces in the organization.');
  command.option('-o, --out [string]', 'Destination file for the json output.');
  command.option('-r, --raw', 'Prints to the console in json format instead of table');
  command.action(async (options) => {
    const resp = await opts.client.platform.getNamespaces(
      {},
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      program.error(pc.red(`Could not fetch namespaces. ${resp.response?.details ?? ''}`));
    }

    if (options.out) {
      const output = resp.namespaces.map(
        (n) =>
          ({
            id: n.id,
            name: n.name,
          }) as OutputFile[number],
      );
      await writeFile(options.out, JSON.stringify(output));
      return;
    }

    if (options.raw) {
      console.log(JSON.stringify(resp.namespaces));
      return;
    }

    const namespaceTable = new Table({
      head: [pc.bold(pc.white('ID')), pc.bold(pc.white('NAME'))],
      colAligns: ['left', 'left'],
      colWidths: [40, 40],
    });

    for (const ns of resp.namespaces) {
      namespaceTable.push([ns.id, ns.name]);
    }
    console.log(namespaceTable.toString());
  });

  return command;
};
