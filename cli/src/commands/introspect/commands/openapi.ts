import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { Command } from 'commander';
import pc from 'picocolors';
import { join, basename } from 'pathe';
import { BaseCommandOptions } from '../../../core/types/types.js';
import program from '../../index.js';
import { introspectOpenApi } from '../../../openapi.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('openapi');
  command.description('Introspects an OpenApi specification.');
  command.argument('<source>', 'Path to the OpenApi specification file.');
  command.option('-o, --out [string]', 'Destination file for the SDL.');
  command.action(async (source, options) => {
    const cwd = process.cwd();

    console.log('options', options, path.resolve(cwd, source));

    const spec = await readFile(path.resolve(cwd, source), {
      encoding: 'utf8',
    });

    if (!spec) {
      program.error(pc.red('Could not read the OpenAPI specification.'));
    }

    const schema = await introspectOpenApi({
      source,
      name: basename(source),
      cwd,
    });

    if (!schema) {
      program.error(pc.red('Could not introspect the subgraph.'));
    }

    if (options.out) {
      await writeFile(join(process.cwd(), options.out), schema ?? '');
    } else {
      console.log(schema);
    }
  });

  return command;
};
