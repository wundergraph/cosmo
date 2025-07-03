import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { getBaseHeaders } from '../../../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description(
    'Lists router tokens of a federated graph or monograph. Only metadata is shown, not the actual token.',
  );
  command.argument('<name>', 'The name of the federated graph or monograph.');
  command.option('-n, --namespace [string]', 'The namespace of the federated graph or monograph.');
  command.action(async (name, options) => {
    const resp = await opts.client.platform.getRouterTokens(
      {
        fedGraphName: name,
        namespace: options.namespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      console.log(pc.red(resp.response?.details));
      program.error(pc.red('Could not fetch the router tokens.'));
    }

    if (resp.tokens.length === 0) {
      console.log('No router tokens for the given graph found');
      return;
    }

    const tokensTable = new Table({
      head: [pc.bold(pc.white('NAME')), pc.bold(pc.white('AUTHOR')), pc.bold(pc.white('CREATED_AT'))],
      wordWrap: true,
      wrapOnWordBoundary: false,
    });

    for (const token of resp.tokens) {
      tokensTable.push([token.name, token.creatorEmail || 'Unset', token.createdAt]);
    }
    console.log(tokensTable.toString());
  });

  return command;
};
