import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService, type ProposalSubgraph } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import CreateProposalCommand from '../src/commands/proposal/commands/create.js';
import UpdateProposalCommand from '../src/commands/proposal/commands/update.js';
import { BaseCommandOptions } from '../src/core/types/types.js';

const commands: Array<[string, (opts: BaseCommandOptions) => Command]> = [
  ['create', CreateProposalCommand],
  ['update', UpdateProposalCommand],
];

describe('proposal --new-subgraph', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  test.each(commands)('%s reads the labels written as its help shows them', async (_name, makeCommand) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wgc-proposal-'));
    const schemaPath = path.join(dir, 'web.graphql');
    await writeFile(schemaPath, 'type Query { web: String }');

    const sent: ProposalSubgraph[] = [];
    const client = createClient(
      PlatformService,
      createRouterTransport(({ service }) => {
        service(PlatformService, {
          createProposal: (request) => {
            sent.push(...request.subgraphs);
            return { response: { code: EnumStatusCode.OK } };
          },
          updateProposal: (request) => {
            if (request.updateAction.case === 'updatedSubgraphs') {
              sent.push(...request.updateAction.value.subgraphs);
            }
            return { response: { code: EnumStatusCode.OK } };
          },
        });
      }),
    );
    const command = makeCommand({ client: { platform: client } });

    const help = command.options.find((option) => option.long === '--new-subgraph')?.description ?? '';
    const format = /Format: (.+?key=value key=value"?)/.exec(help)?.[1] ?? '';
    const value = format
      .replace('subgraph-name', 'web')
      .replace('path-to-schema', schemaPath)
      .replace('key=value key=value', 'team=web graph=storefront');

    const program = new Command();
    program.exitOverride();
    program.addCommand(command);
    await program.parseAsync([command.name(), 'add-web', '-f', 'storefront', '--new-subgraph', value], {
      from: 'user',
    });

    expect(sent.map((subgraph) => subgraph.labels.map(({ key, value }) => `${key}=${value}`))).toEqual([
      ['team=web', 'graph=storefront'],
    ]);
  });
});
