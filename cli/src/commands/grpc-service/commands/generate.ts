import { access, constants, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import {
  compileGraphQLToMapping,
  compileGraphQLToProto,
  compileOperationsToProto,
  ProtoLock,
  ProtoOption,
  ProtoOptions,
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
import { getGoModulePathProtoOption } from '../../router/commands/plugin/toolchain.js';

type CLIOptions = {
  input: string;
  output: string;
  packageName?: string;
  protoLock?: string;
  withOperations?: string;
  customScalarMapping?: string;
  customScalarMappingFile?: string;
  maxDepth?: string;
} & ProtoOptions;

export default (opts: BaseCommandOptions) => {
  const command = new Command('generate');
  command.description('Generate a protobuf schema for a remote gRPC service.');
  command.argument('[name]', 'The name of the proto service.');
  command.requiredOption('-i, --input <path-to-input>', 'The GraphQL schema file to generate a protobuf schema from.');
  command.option('-o, --output <path-to-output>', 'The output directory for the protobuf schema. (default ".").', '.');
  command.option('-p, --package-name <name>', 'The name of the proto package. (default "service.v1")', 'service.v1');
  command.option('-g, --go-package <name>', 'Adds an `option go_package` to the proto file.');
  // NOTE: The following language-specific options are not enabled for the alpha release
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
      'Subdirectories are traversed recursively. When provided, generates proto from operations instead of SDL types.',
  );
  command.option(
    '--custom-scalar-mapping <json>',
    'Custom scalar type mappings as JSON string. ' +
      'Example: \'{"DateTime":"google.protobuf.Timestamp","UUID":"string"}\'',
  );
  command.option(
    '--custom-scalar-mapping-file <path>',
    'Path to JSON file containing custom scalar type mappings. ' + 'Example: ./mappings.json',
  );
  command.option(
    '--max-depth <number>',
    'Maximum recursion depth for processing nested selections and fragments (default: 50). ' +
      'Increase this if you have deeply nested queries or decrease to catch potential circular references earlier.',
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

    // Parse custom scalar mappings if provided
    let customScalarMappings: Record<string, string> | undefined;
    if (options.customScalarMapping && options.customScalarMappingFile) {
      program.error('Cannot use both --custom-scalar-mapping and --custom-scalar-mapping-file. Please use only one.');
    }

    if (options.customScalarMapping) {
      try {
        customScalarMappings = JSON.parse(options.customScalarMapping);
      } catch (error) {
        program.error(
          `Failed to parse custom scalar mapping JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else if (options.customScalarMappingFile) {
      try {
        const filePath = resolve(options.customScalarMappingFile);
        if (!(await exists(filePath))) {
          program.error(`Custom scalar mapping file not found: ${options.customScalarMappingFile}`);
        }
        const fileContent = await readFile(filePath, 'utf8');
        customScalarMappings = JSON.parse(fileContent);
      } catch (error) {
        program.error(
          `Failed to read or parse custom scalar mapping file: ${error instanceof Error ? error.message : String(error)}`,
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

    const languageOptions: ProtoOptions = {
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
    };

    const result = await generateProtoAndMapping({
      outdir: options.output,
      schemaFile: inputFile,
      name,
      spinner,
      packageName: options.packageName,
      languageOptions,
      lockFile: options.protoLock,
      operationsDir: options.withOperations,
      customScalarMappings,
      maxDepth,
    });

    // Write the generated files
    if (result.mapping) {
      await writeFile(resolve(options.output, 'mapping.json'), result.mapping);
    }
    await writeFile(resolve(options.output, 'service.proto'), result.proto);
    if (result.lockData) {
      await writeFile(resolve(options.output, 'service.proto.lock.json'), JSON.stringify(result.lockData, null, 2));
    }

    const generatedFiles = ['service.proto'];
    if (result.mapping) {
      generatedFiles.push('mapping.json');
    }
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

    if (result.isOperationsMode) {
      resultInfo['query idempotency'] = 'NO_SIDE_EFFECTS';
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
  languageOptions: ProtoOptions;
  lockFile?: string;
  operationsDir?: string;
  customScalarMappings?: Record<string, string>;
  maxDepth?: number;
};

/**
 * Read all GraphQL operation files from a directory recursively
 * @param operationsDir - The directory path containing GraphQL operation files
 * @returns An array of objects containing filename and content for each operation file
 */
async function readOperationFiles(operationsDir: string): Promise<Array<{ filename: string; content: string }>> {
  const files = await readdir(operationsDir, { recursive: true });
  const validExtensions = ['.graphql', '.gql', '.graphqls', '.gqls'];
  // Sort files to ensure deterministic output and consistent RPC/method ordering across platforms
  const operationFiles = files.filter((file) => validExtensions.includes(extname(file).toLowerCase())).sort();

  if (operationFiles.length === 0) {
    throw new Error(`No GraphQL operation files (${validExtensions.join(', ')}) found in ${operationsDir}`);
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
 * Generate proto from GraphQL operations
 * @param schema - The GraphQL schema content
 * @param serviceName - The name of the proto service
 * @param operationsPath - The resolved path to the operations directory
 * @param spinner - The spinner instance for progress updates
 * @param packageName - The proto package name
 * @param languageOptions - Language-specific proto options
 * @param lockFile - Path to the proto lock file
 * @param customScalarMappings - Custom scalar type mappings
 * @param maxDepth - Maximum recursion depth
 * @returns Generation result with proto content and lock data
 * @note All Query operations are automatically marked with NO_SIDE_EFFECTS idempotency level
 */
async function generateFromOperations(
  schema: string,
  serviceName: string,
  operationsPath: string,
  spinner: Ora,
  packageName: string,
  languageOptions: ProtoOptions,
  lockFile: string,
  customScalarMappings?: Record<string, string>,
  maxDepth?: number,
): Promise<GenerationResult> {
  spinner.text = 'Reading operation files...';
  const operationFiles = await readOperationFiles(operationsPath);

  spinner.text = `Processing ${operationFiles.length} operation files...`;

  // Load lock data for field number stability
  let currentLockData = await fetchLockData(lockFile);

  // Process each operation file separately, updating lock data sequentially for field number stability.
  // Collect AST roots for merging rather than proto strings.
  const roots: protobuf.Root[] = [];

  for (const { filename, content } of operationFiles) {
    try {
      const result = compileOperationsToProto(content, schema, {
        serviceName,
        packageName: packageName || 'service.v1',
        ...languageOptions,
        includeComments: true,
        // All Query operations are automatically marked as NO_SIDE_EFFECTS (idempotent).
        // This ensures consistent, safe retry behavior for all query operations.
        queryIdempotency: 'NO_SIDE_EFFECTS',
        lockData: currentLockData,
        customScalarMappings,
        maxDepth,
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
    ...languageOptions,
    includeComments: true,
  });

  return {
    mapping: null,
    proto: mergedProto,
    lockData: currentLockData ?? null,
    isOperationsMode: true,
  };
}

/**
 * Generate proto and mapping from GraphQL SDL
 * @param schema - The GraphQL schema content
 * @param serviceName - The name of the proto service
 * @param spinner - The spinner instance for progress updates
 * @param packageName - The proto package name
 * @param languageOptions - Language-specific proto options
 * @param lockFile - Path to the proto lock file
 * @returns Generation result with proto, mapping, and lock data
 */
async function generateFromSDL(
  schema: string,
  serviceName: string,
  spinner: Ora,
  packageName: string | undefined,
  languageOptions: ProtoOptions,
  lockFile: string,
): Promise<GenerationResult> {
  spinner.text = 'Generating mapping and proto files...';

  const lockData = await fetchLockData(lockFile);

  const mapping = compileGraphQLToMapping(schema, serviceName);

  const protoOptions: ProtoOption[] = [];
  if (languageOptions.goPackage) {
    protoOptions.push(getGoModulePathProtoOption(languageOptions.goPackage));
  }
  if (languageOptions.javaPackage) {
    protoOptions.push({ name: 'java_package', constant: `"${languageOptions.javaPackage}"` });
  }
  if (languageOptions.javaOuterClassname) {
    protoOptions.push({ name: 'java_outer_classname', constant: `"${languageOptions.javaOuterClassname}"` });
  }
  if (languageOptions.javaMultipleFiles !== undefined) {
    protoOptions.push({ name: 'java_multiple_files', constant: String(languageOptions.javaMultipleFiles) });
  }
  if (languageOptions.csharpNamespace) {
    protoOptions.push({ name: 'csharp_namespace', constant: `"${languageOptions.csharpNamespace}"` });
  }
  if (languageOptions.rubyPackage) {
    protoOptions.push({ name: 'ruby_package', constant: `"${languageOptions.rubyPackage}"` });
  }
  if (languageOptions.phpNamespace) {
    protoOptions.push({ name: 'php_namespace', constant: `"${languageOptions.phpNamespace}"` });
  }
  if (languageOptions.phpMetadataNamespace) {
    protoOptions.push({ name: 'php_metadata_namespace', constant: `"${languageOptions.phpMetadataNamespace}"` });
  }
  if (languageOptions.objcClassPrefix) {
    protoOptions.push({ name: 'objc_class_prefix', constant: `"${languageOptions.objcClassPrefix}"` });
  }
  if (languageOptions.swiftPrefix) {
    protoOptions.push({ name: 'swift_prefix', constant: `"${languageOptions.swiftPrefix}"` });
  }

  const proto = compileGraphQLToProto(schema, {
    serviceName,
    packageName,
    lockData,
    protoOptions,
  });

  return {
    mapping: JSON.stringify(mapping, null, 2),
    proto: proto.proto,
    lockData: proto.lockData,
    isOperationsMode: false,
  };
}

/**
 * Generate proto and mapping data from schema
 * @param options - Generation options including schema file, output directory, and configuration
 * @returns Generation result with proto content, optional mapping, and lock data
 */
async function generateProtoAndMapping({
  name,
  outdir,
  schemaFile,
  spinner,
  packageName,
  languageOptions,
  lockFile = resolve(outdir, 'service.proto.lock.json'),
  operationsDir,
  customScalarMappings,
  maxDepth,
}: GenerationOptions): Promise<GenerationResult> {
  const schema = await readFile(schemaFile, 'utf8');
  const serviceName = upperFirst(camelCase(name));

  // Validate the GraphQL schema
  spinner.text = 'Validating GraphQL schema...';
  const validationResult = validateGraphQLSDL(schema);
  renderValidationResults(validationResult, schemaFile);

  // Determine generation mode
  if (operationsDir) {
    const operationsPath = resolve(operationsDir);
    return generateFromOperations(
      schema,
      serviceName,
      operationsPath,
      spinner,
      packageName || 'service.v1',
      languageOptions,
      lockFile,
      customScalarMappings,
      maxDepth,
    );
  } else {
    return generateFromSDL(schema, serviceName, spinner, packageName, languageOptions, lockFile);
  }
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
