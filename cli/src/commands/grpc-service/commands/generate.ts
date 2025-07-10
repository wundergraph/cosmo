import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { resolve } from 'pathe';
import Spinner from 'ora';
import { Command, program } from 'commander';
import { compileGraphQLToMapping, compileGraphQLToProto, ProtoLock } from '@wundergraph/protographic';
import { camelCase, upperFirst } from 'lodash-es';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { renderResultTree } from '../../router/commands/plugin/helper.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('generate');
  command.description('Generate a protobuf schema for a remote gRPC service.');
  command.argument('[name]', 'The name of the proto service.');
  command.requiredOption('-i, --input <path-to-input>', 'The GraphQL schema file to generate a protobuf schema from.');
  command.option('-o, --output <path-to-output>', 'The output directory for the protobuf schema. (default ".").', '.');
  command.option('-p, --package-name <name>', 'The name of the proto package. (default "service.v1")', 'service.v1');
  command.option('-g, --go-package <name>', 'Adds an `option go_package` to the proto file.');
  command.action(generateCommandAction);

  return command;
};

type GenerationResult = {
  mapping: string;
  proto: string;
  lockData: ProtoLock | null;
};

async function generateCommandAction(name: string, options: any) {
  if (!name) {
    program.error('A name is required for the proto service');
  }

  const spinner = Spinner();
  spinner.start('Generating protobuf schema...');

  try {
    const inputFile = resolve(options.input);

    // Ensure output directory exists
    if (!existsSync(options.output)) {
      await mkdir(options.output, { recursive: true });
    }

    if (!lstatSync(options.output).isDirectory()) {
      program.error(`Output directory ${options.output} is not a directory`);
    }

    if (!existsSync(inputFile)) {
      program.error(`Input file ${options.input} does not exist`);
    }

    const result = await generateProtoAndMapping(options.output, inputFile, name, options, spinner);

    // Write the generated files
    await writeFile(resolve(options.output, 'mapping.json'), result.mapping);
    await writeFile(resolve(options.output, 'service.proto'), result.proto);
    await writeFile(resolve(options.output, 'service.proto.lock.json'), JSON.stringify(result.lockData, null, 2));

    renderResultTree(spinner, 'Generated protobuf schema', true, name, {
      'input file': inputFile,
      'output dir': options.output,
      'service name': upperFirst(camelCase(name)) + 'Service',
      generated: 'mapping.json, service.proto, service.proto.lock.json',
    });
  } catch (error) {
    renderResultTree(spinner, 'Failed to generate protobuf schema', false, name, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Generate proto and mapping data from schema
 */
async function generateProtoAndMapping(
  outdir: string,
  schemaFile: string,
  name: string,
  options: any,
  spinner: any,
): Promise<GenerationResult> {
  spinner.text = 'Generating proto schema...';
  const lockFile = resolve(outdir, 'service.proto.lock.json');

  const schema = await readFile(schemaFile, 'utf8');
  const serviceName = upperFirst(camelCase(name)) + 'Service';
  spinner.text = 'Generating mapping and proto files...';

  let lockData: ProtoLock | undefined;

  if (existsSync(lockFile)) {
    const existingLockData = JSON.parse(await readFile(lockFile, 'utf8'));
    if (existingLockData) {
      lockData = existingLockData;
    }
  }

  const mapping = compileGraphQLToMapping(schema, serviceName);
  const proto = compileGraphQLToProto(schema, {
    serviceName,
    packageName: options.packageName,
    goPackage: options.goPackage,
    lockData,
  });

  return {
    mapping: JSON.stringify(mapping, null, 2),
    proto: proto.proto,
    lockData: proto.lockData,
  };
}
