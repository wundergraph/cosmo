import { access, constants, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { compileGraphQLToMapping, compileGraphQLToProto, ProtoLock } from '@wundergraph/protographic';
import { Command, program } from 'commander';
import { camelCase, upperFirst } from 'lodash-es';
import Spinner, { type Ora } from 'ora';
import { resolve } from 'pathe';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { renderResultTree } from '../../router/commands/plugin/helper.js';

type CLIOptions = {
  input: string;
  output: string;
  packageName?: string;
  goPackage?: string;
  protoLock?: string;
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('generate');
  command.description('Generate a protobuf schema for a remote gRPC service.');
  command.argument('[name]', 'The name of the proto service.');
  command.requiredOption('-i, --input <path-to-input>', 'The GraphQL schema file to generate a protobuf schema from.');
  command.option('-o, --output <path-to-output>', 'The output directory for the protobuf schema. (default ".").', '.');
  command.option('-p, --package-name <name>', 'The name of the proto package. (default "service.v1")', 'service.v1');
  command.option('-g, --go-package <name>', 'Adds an `option go_package` to the proto file.');
  command.option(
    '-l, --proto-lock <path-to-proto-lock>',
    'The path to the existing proto lock file to use as the starting point for the updated proto lock file. ' +
      'Default is to use and overwrite the output file "<outdir>/service.proto.lock.json".',
  );
  command.action(generateCommandAction);

  return command;
};

type GenerationResult = {
  mapping: string;
  proto: string;
  lockData: ProtoLock | null;
};

async function generateCommandAction(name: string, options: CLIOptions) {
  if (!name) {
    program.error('A name is required for the proto service');
  }

  const spinner = Spinner();
  spinner.start('Generating protobuf schema...');

  try {
    const inputFile = resolve(options.input);

    // Ensure output directory exists
    if (!(await exists(options.output))) {
      await mkdir(options.output, { recursive: true });
    }

    if (!(await lstat(options.output)).isDirectory()) {
      program.error(`Output directory ${options.output} is not a directory`);
    }

    if (!(await exists(inputFile))) {
      program.error(`Input file ${options.input} does not exist`);
    }

    const result = await generateProtoAndMapping({
      outdir: options.output,
      schemaFile: inputFile,
      name,
      spinner,
      packageName: options.packageName,
      goPackage: options.goPackage,
      lockFile: options.protoLock,
    });

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

type GenerationOptions = {
  name: string;
  outdir: string;
  schemaFile: string;
  spinner: Ora;
  packageName?: string;
  goPackage?: string;
  lockFile?: string;
};

/**
 * Generate proto and mapping data from schema
 */
async function generateProtoAndMapping({
  name,
  outdir,
  schemaFile,
  spinner,
  packageName,
  goPackage,
  lockFile = resolve(outdir, 'service.proto.lock.json'),
}: GenerationOptions): Promise<GenerationResult> {
  spinner.text = 'Generating proto schema...';

  const schema = await readFile(schemaFile, 'utf8');
  const serviceName = upperFirst(camelCase(name)) + 'Service';
  spinner.text = 'Generating mapping and proto files...';

  const lockData = await fetchLockData(lockFile);
  const mapping = compileGraphQLToMapping(schema, serviceName);
  const proto = compileGraphQLToProto(schema, {
    serviceName,
    packageName,
    goPackage,
    lockData,
  });

  return {
    mapping: JSON.stringify(mapping, null, 2),
    proto: proto.proto,
    lockData: proto.lockData,
  };
}

async function fetchLockData(lockFile: string): Promise<ProtoLock | undefined> {
  if (!(await exists(lockFile))) {
    return undefined;
  }

  const existingLockData = JSON.parse(await readFile(lockFile, 'utf8'));
  return existingLockData == null ? undefined : existingLockData;
}

// Usage of exists from node:fs is not recommended. Use access instead.
async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
