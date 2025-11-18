import { access, constants, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import {
  compileGraphQLToMapping,
  compileGraphQLToProto,
  compileOperationsToProto,
  ProtoLock,
  validateGraphQLSDL,
  rootToProtoText,
  protobuf,
} from '@wundergraph/protographic';
import { Command, program } from 'commander';
import { camelCase, upperFirst } from 'lodash-es';
import Spinner, { type Ora } from 'ora';
import { resolve, extname } from 'pathe';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { renderResultTree, renderValidationResults } from '../../router/commands/plugin/helper.js';

type CLIOptions = {
  input: string;
  output: string;
  packageName?: string;
  goPackage?: string;
  javaPackage?: string;
  javaOuterClassname?: string;
  javaMultipleFiles?: boolean;
  csharpNamespace?: string;
  rubyPackage?: string;
  phpNamespace?: string;
  phpMetadataNamespace?: string;
  objcClassPrefix?: string;
  swiftPrefix?: string;
  protoLock?: string;
  withOperations?: string;
  queryIdempotency?: string;
  customScalarMapping?: string;
  maxDepth?: string;
  prefixOperationType?: boolean;
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('generate');
  command.description('Generate a protobuf schema for a remote gRPC service.');
  command.argument('[name]', 'The name of the proto service.');
  command.requiredOption('-i, --input <path-to-input>', 'The GraphQL schema file to generate a protobuf schema from.');
  command.option('-o, --output <path-to-output>', 'The output directory for the protobuf schema. (default ".").', '.');
  command.option('-p, --package-name <name>', 'The name of the proto package. (default "service.v1")', 'service.v1');
  command.option('-g, --go-package <name>', 'Adds an `option go_package` to the proto file.');
  // command.option('--java-package <name>', 'Adds an `option java_package` to the proto file.');
  // command.option('--java-outer-classname <name>', 'Adds an `option java_outer_classname` to the proto file.');
  // command.option('--java-multiple-files', 'Adds `option java_multiple_files = true` to the proto file.');
  // command.option('--csharp-namespace <name>', 'Adds an `option csharp_namespace` to the proto file.');
  // command.option('--ruby-package <name>', 'Adds an `option ruby_package` to the proto file.');
  // command.option('--php-namespace <name>', 'Adds an `option php_namespace` to the proto file.');
  // command.option('--php-metadata-namespace <name>', 'Adds an `option php_metadata_namespace` to the proto file.');
  // command.option('--objc-class-prefix <name>', 'Adds an `option objc_class_prefix` to the proto file.');
  // command.option('--swift-prefix <name>', 'Adds an `option swift_prefix` to the proto file.');
  command.option(
    '-l, --proto-lock <path-to-proto-lock>',
    'The path to the existing proto lock file to use as the starting point for the updated proto lock file. ' +
      'Default is to use and overwrite the output file "<outdir>/service.proto.lock.json".',
  );
  command.option(
    '-w, --with-operations <path-to-operations>',
    'Path to directory containing GraphQL operation files (.graphql, .gql, .graphqls, .gqls). ' +
      'When provided, generates proto from operations instead of SDL types.',
  );
  command.option(
    '--query-idempotency <level>',
    'Set idempotency level for Query operations. Valid values: NO_SIDE_EFFECTS, DEFAULT. Only applies with --with-operations.',
  );
  command.option(
    '--custom-scalar-mapping <json-or-path>',
    'Custom scalar type mappings as JSON string or path to JSON file. ' +
      'Example: \'{"DateTime":"google.protobuf.Timestamp","UUID":"string"}\'',
  );
  command.option(
    '--max-depth <number>',
    'Maximum recursion depth for processing nested selections and fragments (default: 50). ' +
      'Increase this if you have deeply nested queries or decrease to catch potential circular references earlier.',
  );
  command.option(
    '--prefix-operation-type',
    'Prefix RPC method names with the operation type (Query/Mutation). Only applies with --with-operations. ' +
      'Subscriptions are not prefixed.',
  );
  command.action(generateCommandAction);

  return command;
};

type GenerationResult = {
  mapping: string | null;
  proto: string;
  lockData: ProtoLock | null;
  isOperationsMode: boolean;
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

    // Validate operations directory if provided
    if (options.withOperations) {
      const operationsPath = resolve(options.withOperations);
      if (!(await exists(operationsPath))) {
        program.error(`Operations directory ${options.withOperations} does not exist`);
      }
      if (!(await lstat(operationsPath)).isDirectory()) {
        program.error(`Path ${options.withOperations} is not a directory`);
      }
    }

    // Validate and warn about query-idempotency usage
    if (options.queryIdempotency) {
      if (!options.withOperations) {
        spinner.warn('--query-idempotency flag is ignored when not using --with-operations');
      }

      const validLevels = ['NO_SIDE_EFFECTS', 'DEFAULT'];
      const level = options.queryIdempotency.toUpperCase();
      if (!validLevels.includes(level)) {
        program.error(
          `Invalid --query-idempotency value: ${options.queryIdempotency}. Valid values are: ${validLevels.join(', ')}`,
        );
      }
    }

    // Parse custom scalar mappings if provided
    let customScalarMappings: Record<string, string> | undefined;
    if (options.customScalarMapping) {
      try {
        customScalarMappings = await parseCustomScalarMapping(options.customScalarMapping);
      } catch (error) {
        program.error(
          `Failed to parse custom scalar mapping: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Parse maxDepth if provided
    let maxDepth: number | undefined;
    if (options.maxDepth) {
      const parsed = Number.parseInt(options.maxDepth, 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        program.error(`Invalid --max-depth value: ${options.maxDepth}. Must be a positive integer.`);
      }
      maxDepth = parsed;
    }

    // Validate prefix-operation-type usage
    if (options.prefixOperationType && !options.withOperations) {
      spinner.warn('--prefix-operation-type flag is ignored when not using --with-operations');
    }

    const result = await generateProtoAndMapping({
      outdir: options.output,
      schemaFile: inputFile,
      name,
      spinner,
      packageName: options.packageName,
      goPackage: options.goPackage,
      javaPackage: options.javaPackage,
      javaOuterClassname: options.javaOuterClassname,
      javaMultipleFiles: options.javaMultipleFiles,
      csharpNamespace: options.csharpNamespace,
      rubyPackage: options.rubyPackage,
      phpNamespace: options.phpNamespace,
      phpMetadataNamespace: options.phpMetadataNamespace,
      objcClassPrefix: options.objcClassPrefix,
      swiftPrefix: options.swiftPrefix,
      lockFile: options.protoLock,
      operationsDir: options.withOperations,
      queryIdempotency: options.queryIdempotency?.toUpperCase(),
      customScalarMappings,
      maxDepth,
      prefixOperationType: options.prefixOperationType,
    });

    // Write the generated files
    if (result.mapping) {
      await writeFile(resolve(options.output, 'mapping.json'), result.mapping);
    }
    await writeFile(resolve(options.output, 'service.proto'), result.proto);
    if (result.lockData) {
      await writeFile(resolve(options.output, 'service.proto.lock.json'), JSON.stringify(result.lockData, null, 2));
    }

    const generatedFiles = [];
    if (result.mapping) {
      generatedFiles.push('mapping.json');
    }
    generatedFiles.push('service.proto');
    if (result.lockData) {
      generatedFiles.push('service.proto.lock.json');
    }

    const resultInfo: Record<string, string> = {
      'input file': inputFile,
      'output dir': options.output,
      'service name': upperFirst(camelCase(name)),
      'generation mode': result.isOperationsMode ? 'operations-based' : 'SDL-based',
      generated: generatedFiles.join(', '),
    };

    if (result.isOperationsMode && options.queryIdempotency) {
      resultInfo['query idempotency'] = options.queryIdempotency.toUpperCase();
    }

    renderResultTree(spinner, 'Generated protobuf schema', true, name, resultInfo);
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
  javaPackage?: string;
  javaOuterClassname?: string;
  javaMultipleFiles?: boolean;
  csharpNamespace?: string;
  rubyPackage?: string;
  phpNamespace?: string;
  phpMetadataNamespace?: string;
  objcClassPrefix?: string;
  swiftPrefix?: string;
  lockFile?: string;
  operationsDir?: string;
  queryIdempotency?: string;
  customScalarMappings?: Record<string, string>;
  maxDepth?: number;
  prefixOperationType?: boolean;
};

/**
 * Read all GraphQL operation files from a directory
 * Returns an array of {filename, content} objects
 */
async function readOperationFiles(operationsDir: string): Promise<Array<{ filename: string; content: string }>> {
  const files = await readdir(operationsDir);
  const operationFiles = files.filter((file) => {
    const ext = extname(file).toLowerCase();
    return ext === '.graphql' || ext === '.gql' || ext === '.graphqls' || ext === '.gqls';
  });

  if (operationFiles.length === 0) {
    throw new Error(`No GraphQL operation files (.graphql, .gql, .graphqls, .gqls) found in ${operationsDir}`);
  }

  const operations: Array<{ filename: string; content: string }> = [];
  for (const file of operationFiles) {
    const filePath = resolve(operationsDir, file);
    const content = await readFile(filePath, 'utf8');
    operations.push({ filename: file, content });
  }

  return operations;
}

/**
 * Merge multiple protobufjs Root ASTs into a single Root
 * Combines all messages, enums, and RPC methods from multiple operations
 */
function mergeProtoRoots(roots: protobuf.Root[], serviceName: string): protobuf.Root {
  if (roots.length === 0) {
    throw new Error('No proto roots to merge');
  }

  if (roots.length === 1) {
    return roots[0];
  }

  // Create a new merged root
  const mergedRoot = new protobuf.Root();
  const seenMessages = new Set<string>();
  const seenEnums = new Set<string>();
  const mergedService = new protobuf.Service(serviceName);

  for (const root of roots) {
    // Iterate through all nested types in the root
    for (const nested of Object.values(root.nestedArray)) {
      if (nested instanceof protobuf.Type) {
        // Add message if not already seen
        const message = nested as protobuf.Type;
        if (!seenMessages.has(message.name)) {
          mergedRoot.add(message);
          seenMessages.add(message.name);
        }
      } else if (nested instanceof protobuf.Enum) {
        // Add enum if not already seen
        const enumType = nested as protobuf.Enum;
        if (!seenEnums.has(enumType.name)) {
          mergedRoot.add(enumType);
          seenEnums.add(enumType.name);
        }
      } else if (nested instanceof protobuf.Service) {
        // Merge all RPC methods from all services
        const service = nested as protobuf.Service;
        for (const method of Object.values(service.methods)) {
          mergedService.add(method);
        }
      }
    }
  }

  // Add the merged service to the root
  mergedRoot.add(mergedService);

  return mergedRoot;
}

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
  javaPackage,
  javaOuterClassname,
  javaMultipleFiles,
  csharpNamespace,
  rubyPackage,
  phpNamespace,
  phpMetadataNamespace,
  objcClassPrefix,
  swiftPrefix,
  lockFile = resolve(outdir, 'service.proto.lock.json'),
  operationsDir,
  queryIdempotency,
  customScalarMappings,
  maxDepth,
  prefixOperationType,
}: GenerationOptions): Promise<GenerationResult> {
  const schema = await readFile(schemaFile, 'utf8');
  const serviceName = upperFirst(camelCase(name));

  // Validate the GraphQL schema
  spinner.text = 'Validating GraphQL schema...';
  const validationResult = validateGraphQLSDL(schema);
  renderValidationResults(validationResult, schemaFile);

  // Determine generation mode
  if (operationsDir) {
    // Operations-based generation
    spinner.text = 'Reading operation files...';
    const operationsPath = resolve(operationsDir);
    const operationFiles = await readOperationFiles(operationsPath);

    spinner.text = `Processing ${operationFiles.length} operation files...`;

    // Load lock data for field number stability
    let currentLockData = await fetchLockData(lockFile);

    // Process each operation file separately to maintain reversibility
    // Collect the AST roots instead of proto strings
    const roots: protobuf.Root[] = [];

    for (const { filename, content } of operationFiles) {
      try {
        const result = compileOperationsToProto(content, schema, {
          serviceName,
          packageName: packageName || 'service.v1',
          goPackage,
          javaPackage,
          javaOuterClassname,
          javaMultipleFiles,
          csharpNamespace,
          rubyPackage,
          phpNamespace,
          phpMetadataNamespace,
          objcClassPrefix,
          swiftPrefix,
          includeComments: true,
          queryIdempotency: queryIdempotency as 'NO_SIDE_EFFECTS' | 'DEFAULT' | undefined,
          lockData: currentLockData,
          customScalarMappings,
          maxDepth,
          prefixOperationType,
        });

        // Keep the AST root instead of the string
        roots.push(result.root);
        // Use the updated lock data for the next operation to maintain field number stability
        currentLockData = result.lockData;
      } catch (error) {
        throw new Error(
          `Failed to process operation file ${filename}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Merge all proto ASTs into a single root
    const mergedRoot = mergeProtoRoots(roots, serviceName);

    // Convert the merged AST to proto text once
    const mergedProto = rootToProtoText(mergedRoot, {
      packageName: packageName || 'service.v1',
      goPackage,
      javaPackage,
      javaOuterClassname,
      javaMultipleFiles,
      csharpNamespace,
      rubyPackage,
      phpNamespace,
      phpMetadataNamespace,
      objcClassPrefix,
      swiftPrefix,
      includeComments: true,
    });

    return {
      mapping: null,
      proto: mergedProto,
      lockData: currentLockData ?? null,
      isOperationsMode: true,
    };
  } else {
    // SDL-based generation (original behavior)
    spinner.text = 'Generating mapping and proto files...';

    const lockData = await fetchLockData(lockFile);

    const mapping = compileGraphQLToMapping(schema, serviceName);
    const proto = compileGraphQLToProto(schema, {
      serviceName,
      packageName,
      goPackage,
      javaPackage,
      javaOuterClassname,
      javaMultipleFiles,
      csharpNamespace,
      rubyPackage,
      phpNamespace,
      phpMetadataNamespace,
      objcClassPrefix,
      swiftPrefix,
      lockData,
    });

    return {
      mapping: JSON.stringify(mapping, null, 2),
      proto: proto.proto,
      lockData: proto.lockData,
      isOperationsMode: false,
    };
  }
}

async function fetchLockData(lockFile: string): Promise<ProtoLock | undefined> {
  if (!(await exists(lockFile))) {
    return undefined;
  }

  const existingLockData = JSON.parse(await readFile(lockFile, 'utf8'));
  return existingLockData == null ? undefined : existingLockData;
}

/**
 * Parse custom scalar mapping from JSON string or file path
 */
async function parseCustomScalarMapping(input: string): Promise<Record<string, string>> {
  // Check if input starts with @ to indicate a file path
  if (input.startsWith('@')) {
    const filePath = resolve(input.slice(1));
    if (!(await exists(filePath))) {
      throw new Error(`Custom scalar mapping file not found: ${filePath}`);
    }
    const fileContent = await readFile(filePath, 'utf8');
    return JSON.parse(fileContent);
  }

  // Otherwise, treat as inline JSON
  return JSON.parse(input);
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
