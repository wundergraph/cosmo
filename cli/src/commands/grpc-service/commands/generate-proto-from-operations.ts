import { access, constants, readdir, readFile, writeFile } from 'node:fs/promises';
import { OperationToProtoVisitor, type OperationInfo, type ProtoLock } from '@wundergraph/protographic';
import { Command, program } from 'commander';
import { camelCase, upperFirst } from 'lodash-es';
import Spinner, { type Ora } from 'ora';
import { resolve, join, extname } from 'pathe';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { renderResultTree } from '../../router/commands/plugin/helper.js';

type CLIOptions = {
  serviceName: string;
  sdl: string;
  operations: string;
  output: string;
  package?: string;
  goPackage?: string;
  markQueriesIdempotent?: boolean;
  includeComments?: boolean;
  lockFile?: string;
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('generate-proto-from-operations');
  command.description('Generate a protobuf schema from GraphQL operations (queries, mutations, subscriptions).');
  command.requiredOption('-s, --service-name <name>', 'The name of the proto service.');
  command.requiredOption('--sdl <path-to-sdl>', 'The GraphQL schema (SDL) file.');
  command.requiredOption('--operations <path-to-operations>', 'The directory containing GraphQL operation files (*.graphql).');
  command.requiredOption('-o, --output <path-to-output>', 'The output file path for the generated protobuf schema.');
  command.option('-p, --package <name>', 'The name of the proto package. (default "service.v1")', 'service.v1');
  command.option('-g, --go-package <name>', 'Adds an `option go_package` to the proto file.');
  command.option(
    '--mark-queries-idempotent',
    'Mark query operations as idempotent (adds idempotency_level = NO_SIDE_EFFECTS option).'
  );
  command.option('--include-comments', 'Include GraphQL descriptions as proto comments.');
  command.option(
    '-l, --lock-file <path-to-lock-file>',
    'The path to the existing proto lock file to use for maintaining stable field numbers. ' +
      'Default is to use and overwrite "<output>.lock.json".'
  );
  command.action(generateCommandAction);

  return command;
};

type GenerationResult = {
  proto: string;
  lockData: ProtoLock | null;
};

async function generateCommandAction(options: CLIOptions) {
  const spinner = Spinner();
  spinner.start('Generating protobuf schema from operations...');

  try {
    const sdlFile = resolve(options.sdl);
    const operationsDir = resolve(options.operations);
    const outputFile = resolve(options.output);

    // Validate inputs
    if (!(await exists(sdlFile))) {
      program.error(`SDL file ${options.sdl} does not exist`);
    }

    if (!(await exists(operationsDir))) {
      program.error(`Operations directory ${options.operations} does not exist`);
    }

    const result = await generateProtoFromOperations({
      serviceName: options.serviceName,
      sdlFile,
      operationsDir,
      spinner,
      packageName: options.package,
      goPackage: options.goPackage,
      markQueriesIdempotent: options.markQueriesIdempotent,
      includeComments: options.includeComments,
      lockFile: options.lockFile || `${outputFile}.lock.json`,
    });

    // Write the generated files
    await writeFile(outputFile, result.proto);
    await writeFile(`${outputFile}.lock.json`, JSON.stringify(result.lockData, null, 2));

    // Format service name for display (avoid duplication if already ends with 'Service')
    const formattedServiceName = upperFirst(camelCase(options.serviceName));
    const displayServiceName = formattedServiceName.endsWith('Service')
      ? formattedServiceName
      : formattedServiceName + 'Service';

    renderResultTree(spinner, 'Generated protobuf schema from operations', true, options.serviceName, {
      'SDL file': sdlFile,
      'operations dir': operationsDir,
      'output file': outputFile,
      'service name': displayServiceName,
      generated: `${outputFile}, ${outputFile}.lock.json`,
    });
  } catch (error) {
    renderResultTree(spinner, 'Failed to generate protobuf schema', false, options.serviceName, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

type GenerationOptions = {
  serviceName: string;
  sdlFile: string;
  operationsDir: string;
  spinner: Ora;
  packageName?: string;
  goPackage?: string;
  markQueriesIdempotent?: boolean;
  includeComments?: boolean;
  lockFile?: string;
};

/**
 * Generate proto from GraphQL operations
 */
async function generateProtoFromOperations({
  serviceName,
  sdlFile,
  operationsDir,
  spinner,
  packageName,
  goPackage,
  markQueriesIdempotent,
  includeComments,
  lockFile,
}: GenerationOptions): Promise<GenerationResult> {
  spinner.text = 'Reading SDL schema...';
  const schema = await readFile(sdlFile, 'utf8');

  spinner.text = 'Scanning for operation files...';
  const operations = await loadOperations(operationsDir);

  if (operations.length === 0) {
    throw new Error(`No GraphQL operation files (*.graphql) found in ${operationsDir}`);
  }

  spinner.text = `Found ${operations.length} operation(s), generating proto...`;

  const lockData = lockFile ? await fetchLockData(lockFile) : undefined;

  // Create the visitor with all options
  // Only append 'Service' if it's not already present
  const formattedServiceName = upperFirst(camelCase(serviceName));
  const finalServiceName = formattedServiceName.endsWith('Service')
    ? formattedServiceName
    : formattedServiceName + 'Service';
  
  const visitor = new OperationToProtoVisitor(schema, operations, {
    serviceName: finalServiceName,
    packageName,
    goPackage,
    lockData,
    includeComments,
    markQueriesIdempotent,
  });

  const proto = visitor.visit();
  const generatedLockData = visitor.getGeneratedLockData();

  return {
    proto,
    lockData: generatedLockData,
  };
}

/**
 * Load all GraphQL operation files from a directory
 */
async function loadOperations(operationsDir: string): Promise<OperationInfo[]> {
  const files = await readdir(operationsDir);
  const operations: OperationInfo[] = [];

  for (const file of files) {
    // Only process .graphql files
    if (extname(file) !== '.graphql') {
      continue;
    }

    const filePath = join(operationsDir, file);
    const content = await readFile(filePath, 'utf8');

    // Use the filename (without extension) as the operation name
    const name = file.replace(/\.graphql$/, '');

    operations.push({
      name,
      content,
      filePath,
    });
  }

  return operations;
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