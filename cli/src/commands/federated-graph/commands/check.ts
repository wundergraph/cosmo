import Table from 'cli-table3';
import { Command } from 'commander';
import logSymbols from 'log-symbols';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('check');
  command.description('Validates the federated graph with the provided configuration for errors.');
  command.argument(
    '<name>',
    'The name of the federated graph. It is usually in the format of <org>.<env> and is used to uniquely identify your federated graph.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.');
  command.requiredOption(
    '--label-matcher <labels...>',
    'The label matchers to the federated graph with which the check is to be performed',
  );

  command.action(async (name, options) => {
    let success = false;
    const resp = await opts.client.platform.checkFederatedGraph(
      {
        name,
        labelMatchers: options.labelMatcher,
        namespace: options.namespace,
      },
      {
        headers: baseHeaders,
      },
    );

    const compositionErrorsTable = new Table({
      head: [pc.bold(pc.white('ERROR_MESSAGE'))],
      colWidths: [120],
      wordWrap: true,
    });

    const matchedSubgraphsTable = new Table({
      head: [
        pc.bold(pc.white('NAME')),
        pc.bold(pc.white('NAMESPACE')),
        pc.bold(pc.white('URL')),
        pc.bold(pc.white('LABELS')),
      ],
      colWidths: [30, 30, 40, 50],
      wordWrap: true,
    });

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        success = true;
        for (const subgraph of resp.subgraphs) {
          matchedSubgraphsTable.push([
            subgraph.name,
            subgraph.namespace,
            subgraph.routingURL,
            subgraph.labels.reduce((accumulator, currentLabel) => accumulator + joinLabel(currentLabel), ''),
          ]);
        }
        console.log(matchedSubgraphsTable.toString());
        console.log('\n' + logSymbols.success + pc.green(' Schema check passed.'));
        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        console.log(pc.white('\nMatched Subgraphs are as follows.'));
        for (const subgraph of resp.subgraphs) {
          matchedSubgraphsTable.push([
            subgraph.name,
            subgraph.namespace,
            subgraph.routingURL,
            subgraph.labels.reduce((accumulator, currentLabel) => accumulator + joinLabel(currentLabel), ''),
          ]);
        }
        console.log(matchedSubgraphsTable.toString());

        console.log(pc.red('\nDetected composition errors.'));
        for (const compositionError of resp.compositionErrors) {
          compositionErrorsTable.push([compositionError.message]);
        }
        console.log(compositionErrorsTable.toString());
        console.log(logSymbols.error + pc.red(' Schema check failed.'));
        break;
      }
      default: {
        console.log('\nFailed to perform the check operation.');
        if (resp.response?.details) {
          console.log(pc.red(pc.bold(resp.response?.details)));
        }
        console.log(logSymbols.error + pc.red(' Schema check failed.'));
      }
    }

    if (!success) {
      process.exit(1);
    }
  });

  return command;
};
