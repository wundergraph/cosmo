import { access, constants, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import {
  compileGraphQLToMapping,
  compileGraphQLToProto,
  compileOperationsToProto,
  ProtoLock,
  validateGraphQLSDL,
} from '@wundergraph/protographic';
import { Command, program } from 'commander';
import { camelCase, upperFirst } from 'lodash-es';
import Spinner, { type Ora } from 'ora';
import { resolve, extname } from 'pathe';
import { parse, OperationDefinitionNode, FragmentDefinitionNode, print, visit } from 'graphql';
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
  command.option('--java-package <name>', 'Adds an `option java_package` to the proto file.');
  command.option('--java-outer-classname <name>', 'Adds an `option java_outer_classname` to the proto file.');
  command.option('--java-multiple-files', 'Adds `option java_multiple_files = true` to the proto file.');
  command.option('--csharp-namespace <name>', 'Adds an `option csharp_namespace` to the proto file.');
  command.option('--ruby-package <name>', 'Adds an `option ruby_package` to the proto file.');
  command.option('--php-namespace <name>', 'Adds an `option php_namespace` to the proto file.');
  command.option('--php-metadata-namespace <name>', 'Adds an `option php_metadata_namespace` to the proto file.');
  command.option('--objc-class-prefix <name>', 'Adds an `option objc_class_prefix` to the proto file.');
  command.option('--swift-prefix <name>', 'Adds an `option swift_prefix` to the proto file.');
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
    'Prefix RPC method names with operation type (Query, Mutation, Subscription). ' +
      'Only applies with --with-operations. Example: "GetUser" becomes "QueryGetUser".',
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
};

/**
 * Read all GraphQL operation files from a directory and extract individual named operations
 * Returns an array of operation documents, where each document contains a single named operation
 * along with only the fragments it actually uses
 */
async function readOperationFiles(operationsDir: string): Promise<Array<{ operation: string; name: string }>> {
  const files = await readdir(operationsDir);
  const operationFiles = files.filter((file) => {
    const ext = extname(file).toLowerCase();
    return ext === '.graphql' || ext === '.gql' || ext === '.graphqls' || ext === '.gqls';
  });

  if (operationFiles.length === 0) {
    throw new Error(`No GraphQL operation files (.graphql, .gql, .graphqls, .gqls) found in ${operationsDir}`);
  }

  // Read all files and collect their content
  const allContent: string[] = [];
  for (const file of operationFiles) {
    const filePath = resolve(operationsDir, file);
    const content = await readFile(filePath, 'utf8');
    allContent.push(content);
  }

  // Parse all content to extract operations and fragments
  const combinedContent = allContent.join('\n\n');
  const document = parse(combinedContent);

  // Strip custom directives from the document
  const cleanedDocument = visit(document, {
    Directive(node) {
      // Remove custom directives (keep only standard GraphQL directives)
      const standardDirectives = ['skip', 'include', 'deprecated', 'specifiedBy'];
      if (!standardDirectives.includes(node.name.value)) {
        return null; // Remove this directive
      }
    },
  });

  // Collect all fragments
  const fragmentsMap = new Map<string, FragmentDefinitionNode>();
  for (const def of cleanedDocument.definitions) {
    if (def.kind === 'FragmentDefinition') {
      fragmentsMap.set(def.name.value, def);
    }
  }

  // Extract each named operation as a separate document
  const operations = cleanedDocument.definitions.filter(
    (def) => def.kind === 'OperationDefinition' && def.name,
  ) as OperationDefinitionNode[];

  if (operations.length === 0) {
    throw new Error(`No named operations found in ${operationsDir}. All operations must have a name.`);
  }

  // Create a separate document for each operation with only the fragments it uses
  const operationDocuments = operations.map((op) => {
    // Find all fragment spreads used in this operation
    const usedFragments = new Set<string>();
    const findFragmentSpreads = (node: any) => {
      visit(node, {
        FragmentSpread(spreadNode) {
          usedFragments.add(spreadNode.name.value);
        },
      });
    };
    findFragmentSpreads(op);

    // Recursively find fragments used by other fragments
    const allUsedFragments = new Set<string>(usedFragments);
    let changed = true;
    while (changed) {
      changed = false;
      for (const fragName of allUsedFragments) {
        const frag = fragmentsMap.get(fragName);
        if (frag) {
          const nestedFragments = new Set<string>();
          findFragmentSpreads(frag);
          visit(frag, {
            FragmentSpread(spreadNode) {
              if (!allUsedFragments.has(spreadNode.name.value)) {
                allUsedFragments.add(spreadNode.name.value);
                changed = true;
              }
            },
          });
        }
      }
    }

    // Build document with operation and only its used fragments
    const parts: string[] = [];
    
    // Add used fragments first
    for (const fragName of allUsedFragments) {
      const frag = fragmentsMap.get(fragName);
      if (frag) {
        parts.push(print(frag));
      }
    }

    // Add the operation
    parts.push(print(op));

    return {
      operation: parts.join('\n\n'),
      name: op.name!.value,
    };
  });

  return operationDocuments;
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
    const operationDocuments = await readOperationFiles(operationsPath);

    spinner.text = `Found ${operationDocuments.length} operations, compiling each separately...`;

    // Load lock data for field number stability
    let lockData = await fetchLockData(lockFile);

<<<<<<< Updated upstream
    spinner.text = 'Generating proto from operations...';
    const result = compileOperationsToProto(operations, schema, {
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
      lockData,
      customScalarMappings,
      maxDepth,
    });
=======
    // Compile each operation separately and merge results
    const protoResults: string[] = [];
    const serviceDefinitions: string[] = [];

    for (const { operation, name: operationName } of operationDocuments) {
      spinner.text = `Compiling operation: ${operationName}...`;

      const result = compileOperationsToProto(operation, schema, {
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
        lockData,
        customScalarMappings,
        maxDepth,
        prefixOperationType,
      });

      // Update lock data for next operation
      lockData = result.lockData;

      // Extract service definition (RPC method) from this operation's proto
      const serviceMatch = result.proto.match(/service\s+\w+\s*\{([^}]+)\}/s);
      if (serviceMatch) {
        serviceDefinitions.push(serviceMatch[1].trim());
      }

      // Store the proto (we'll merge them later)
      protoResults.push(result.proto);
    }

    // Merge all protos into a single file
    spinner.text = 'Merging proto definitions...';
    const mergedProto = mergeProtoResults(protoResults, serviceName, serviceDefinitions);
>>>>>>> Stashed changes

    return {
      mapping: null,
      proto: mergedProto,
      lockData: lockData ?? null,
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
 * Merge multiple proto compilation results into a single proto file
 * Combines all message definitions and creates a single service with all RPC methods
 */
function mergeProtoResults(protoResults: string[], serviceName: string, serviceDefinitions: string[]): string {
  if (protoResults.length === 0) {
    throw new Error('No proto results to merge');
  }

  // Use the first proto as the base (it has the header, package, imports)
  const firstProto = protoResults[0];

  // Extract header (everything before the first message or service)
  const headerMatch = firstProto.match(/^([\s\S]*?)(?=message|service)/);
  const header = headerMatch ? headerMatch[1].trim() : '';

  // Collect all unique message and enum definitions from all protos
  const allMessages = new Set<string>();
  const allEnums = new Set<string>();

  for (const proto of protoResults) {
    // Extract message definitions
    const messageMatches = proto.matchAll(/message\s+\w+\s*\{[\s\S]*?\n\}/g);
    for (const match of messageMatches) {
      allMessages.add(match[0]);
    }

    // Extract enum definitions
    const enumMatches = proto.matchAll(/enum\s+\w+\s*\{[\s\S]*?\n\}/g);
    for (const match of enumMatches) {
      allEnums.add(match[0]);
    }
  }

  // Build the merged proto
  const parts: string[] = [header, ''];

  // Add service with all RPC methods
  parts.push(`service ${serviceName} {`);
  for (const serviceDef of serviceDefinitions) {
    parts.push(`  ${serviceDef}`);
  }
  parts.push('}', '');

  // Add all unique messages
  for (const message of allMessages) {
    parts.push(message, '');
  }

  // Add all unique enums
  for (const enumDef of allEnums) {
    parts.push(enumDef, '');
  }

  return parts.join('\n');
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
