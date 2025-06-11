import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'pathe';
import Spinner from 'ora';
import { Command, program } from 'commander';
import { compileGraphQLToMapping, compileGraphQLToProto, ProtoLock } from '@wundergraph/protographic';
import { camelCase, upperFirst } from 'lodash-es';
import pc from 'picocolors';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('generate');
  command.description('generate a protobuf schema for a standalone grpc subgraph');
  command.argument('[name]', 'The name of the standalone grpc subgraph', 'helloworld');

  command.requiredOption('-i, --input <path-to-input>', 'The GraphQL schema file to generate a protobuf schema from.');
  command.option(
    '-o, --output <path-to-output>',
    'The output directory for the protobuf schema. If not provided, the output directory will be the same as the input file.',
    '',
  );
  command.option('--no-lock', 'Skip generating and using the lock file for deterministic field ordering');
  command.action(generateCommandAction);

  return command;
};

type GenerationResult = {
  mapping: string;
  proto: string;
  lockData: ProtoLock | null;
};

async function generateCommandAction(name: string, options: any) {
  const spinner = Spinner();
  spinner.start('Generating protobuf schema...');

  try {
    const inputFile = resolve(options.input);

    let outputDir = options.output;
    if (outputDir === '') {
      outputDir = dirname(inputFile);
    }

    if (!existsSync(inputFile)) {
      program.error(`Input file ${options.input} does not exist`);
    }

    const result = await generateProtoAndMapping(outputDir, inputFile, name, spinner, options.lock);

    // Write the generated files
    await writeFile(resolve(outputDir, 'mapping.json'), JSON.stringify(result.mapping, null, 2));
    await writeFile(resolve(outputDir, 'service.proto'), result.proto);
    if (options.lock) {
      await writeFile(resolve(outputDir, 'service.proto.lock.json'), JSON.stringify(result.lockData, null, 2));
    }
  } finally {
    const symbol = pc.green('[●]');

    spinner.stopAndPersist({
      symbol,
      text: pc.bold('Generated protobuf schema'),
    });
  }
}

/**
 * Generate proto and mapping data from schema
 */
async function generateProtoAndMapping(
  outdir: string,
  schemaFile: string,
  name: string,
  spinner: any,
  useLock = true,
): Promise<GenerationResult> {
  spinner.text = 'Generating proto schema...';
  const lockFile = resolve(outdir, 'service.proto.lock.json');

  const schema = await readFile(schemaFile, 'utf8');
  const serviceName = upperFirst(camelCase(name)) + 'Service';
  spinner.text = 'Generating mapping and proto files...';

  let lockData: ProtoLock | undefined;

  if (useLock && existsSync(lockFile)) {
    const existingLockData = JSON.parse(await readFile(lockFile, 'utf8'));
    if (existingLockData) {
      lockData = existingLockData;
    }
  }

  const mapping = compileGraphQLToMapping(schema, serviceName);
  const proto = compileGraphQLToProto(schema, {
    serviceName,
    packageName: 'service',
    lockData: useLock ? lockData : undefined,
  });

  return {
    mapping: JSON.stringify(mapping, null, 2),
    proto: proto.proto,
    lockData: useLock ? proto.lockData : null,
  };
}
