import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { resolve, dirname } from 'pathe';
import Spinner from 'ora';
import { Command, program } from 'commander';
import { compileGraphQLToMapping, compileGraphQLToProto, ProtoLock } from '@wundergraph/protographic';
import { camelCase, upperFirst } from 'lodash-es';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { renderResultTree } from '../../router/plugin/helper.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('generate');
  command.description('generate a protobuf schema for a standalone grpc subgraph');
  command.argument('[name]', 'The name of the proto service');
  command.requiredOption('-i, --input <path-to-input>', 'The GraphQL schema file to generate a protobuf schema from.');
  command.option(
    '-o, --output <path-to-output>',
    'The output directory for the protobuf schema. If not provided, the output directory will be the same as the input file.',
    '',
  );
  command.option(
    '-p, --package-name <name>',
    'The name of the proto package. If not provided, the package name will default to "service".',
    'service',
  );
  command.option(
    '-g, --go-package <name>',
    'The name of the go package. If not provided, the go package name will default to "github.com/wundergraph/cosmo/demo/test".',
    'github.com/wundergraph/cosmo/demo/test',
  );
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

    let outputDir = options.output;
    if (outputDir === '') {
      outputDir = dirname(inputFile);
    }

    if (!existsSync(outputDir)) {
      program.error(`Output directory ${outputDir} does not exist`);
    }

    if (!lstatSync(outputDir).isDirectory()) {
      program.error(`Output directory ${outputDir} is not a directory`);
    }

    if (!existsSync(inputFile)) {
      program.error(`Input file ${options.input} does not exist`);
    }

    const result = await generateProtoAndMapping(outputDir, inputFile, name, options, spinner);

    // Write the generated files
    await writeFile(resolve(outputDir, 'mapping.json'), result.mapping);
    await writeFile(resolve(outputDir, 'service.proto'), result.proto);
    await writeFile(resolve(outputDir, 'service.proto.lock.json'), JSON.stringify(result.lockData, null, 2));

    renderResultTree(spinner, 'Generated protobuf schema', true, name, {
      'input file': inputFile,
      'output dir': outputDir,
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
