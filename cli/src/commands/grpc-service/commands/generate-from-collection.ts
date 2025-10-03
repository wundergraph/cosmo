import { access, constants, lstat, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import {
    compileOperationsToProto,
    enhanceSDLWithOpenApiDirective,
    OperationInfo,
    ProtoLock,
    validateGraphQLSDL,
} from '@wundergraph/protographic';
import { Command, program } from 'commander';
import { camelCase, upperFirst } from 'lodash-es';
import Spinner, { type Ora } from 'ora';
import { resolve, extname } from 'pathe';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { renderResultTree, renderValidationResults } from '../../router/commands/plugin/helper.js';

type CLIOptions = {
    schema: string;
    collection: string;
    output: string;
    packageName?: string;
    goPackage?: string;
    protoLock?: string;
    markQueriesIdempotent?: boolean;
};

export default (opts: BaseCommandOptions) => {
    const command = new Command('generate-from-collection');
    command.description('Generate a proto from a collection GraphQL operations and SDL.');
    command.argument('[name]', 'The name of the proto service.');
    command.requiredOption('-s, --schema <path>', 'The GraphQL schema file.');
    command.requiredOption('-c, --collection <path>', 'The directory containing GraphQL operation files.');
    command.option('-o, --output <path>', 'The output directory for the protobuf schema. (default ".").', '.');
    command.option('-p, --package-name <name>', 'The name of the proto package. (default "service.v1")', 'service.v1');
    command.option('-g, --go-package <name>', 'Adds an `option go_package` to the proto file.');
    command.option(
        '-l, --proto-lock <path>',
        'The path to the existing proto lock file to use as the starting point for the updated proto lock file. ' +
        'Default is to use and overwrite the output file "<outdir>/service.proto.lock.json".',
    );
    command.option(
        '--mark-queries-idempotent',
        'Add idempotency_level = NO_SIDE_EFFECTS option to query operations for GET request support.',
    );
    command.action(generateFromOperationsAction);

    return command;
};

type GenerationResult = {
    proto: string;
    lockData: ProtoLock | null;
};

async function generateFromOperationsAction(name: string, options: CLIOptions) {
    if (!name) {
        program.error('A name is required for the proto service');
    }

    const spinner = Spinner();
    spinner.start('Generating protobuf schema from operations...');

    try {
        const schemaFile = resolve(options.schema);
        const collectionDir = resolve(options.collection);

        // Ensure output directory exists
        if (!(await exists(options.output))) {
            await mkdir(options.output, { recursive: true });
        }

        if (!(await lstat(options.output)).isDirectory()) {
            program.error(`Output directory ${options.output} is not a directory`);
        }

        if (!(await exists(schemaFile))) {
            program.error(`Schema file ${options.schema} does not exist`);
        }

        if (!(await exists(collectionDir))) {
            program.error(`Operations directory ${options.collection} does not exist`);
        }

        const result = await generateProtoFromCollection({
            outdir: options.output,
            schemaFile,
            collectionDir,
            name,
            spinner,
            packageName: options.packageName,
            goPackage: options.goPackage,
            lockFile: options.protoLock,
            markQueriesIdempotent: options.markQueriesIdempotent,
        });

        // Write the generated files
        await writeFile(resolve(options.output, 'service.proto'), result.proto);
        if (result.lockData) {
            await writeFile(resolve(options.output, 'service.proto.lock.json'), JSON.stringify(result.lockData, null, 2));
        }

        renderResultTree(spinner, 'Generated protobuf schema from collection', true, name, {
            'schema file': schemaFile,
            'collection dir': collectionDir,
            'output dir': options.output,
            'service name': upperFirst(camelCase(name)) + 'Service',
            generated: result.lockData ? 'service.proto, service.proto.lock.json' : 'service.proto',
        });
    } catch (error) {
        renderResultTree(spinner, 'Failed to generate protobuf schema from operations', false, name, {
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}

type GenerationOptions = {
    name: string;
    outdir: string;
    schemaFile: string;
    collectionDir: string;
    spinner: Ora;
    packageName?: string;
    goPackage?: string;
    lockFile?: string;
    markQueriesIdempotent?: boolean;
};

/**
 * Generate proto from collection and schema
 */
async function generateProtoFromCollection({
                                               name,
                                               outdir,
                                               schemaFile,
                                               collectionDir,
                                               spinner,
                                               packageName,
                                               goPackage,
                                               lockFile = resolve(outdir, 'service.proto.lock.json'),
                                               markQueriesIdempotent,
                                           }: GenerationOptions): Promise<GenerationResult> {
    spinner.text = 'Reading schema and collection...';

    const schema = await readFile(schemaFile, 'utf8');
    const serviceName = upperFirst(camelCase(name)) + 'Service';

    // Read all GraphQL operation files from collection
    const operations = await loadOperations(collectionDir, spinner);

    if (operations.length === 0) {
        throw new Error('No GraphQL operation files found in the collection directory');
    }

    spinner.text = `Found ${operations.length} operation(s)...`;

    const lockData = await fetchLockData(lockFile);

    // Validate the GraphQL schema and render results
    spinner.text = 'Validating GraphQL schema...';
    const validationResult = validateGraphQLSDL(schema);
    renderValidationResults(validationResult, schemaFile);

    // Enhance SDL with @openapi directive definition to support OpenAPI metadata
    spinner.text = 'Enhancing schema with OpenAPI directive support...';
    const enhancedSchema = enhanceSDLWithOpenApiDirective(schema);

    // Generate proto from operations
    spinner.text = 'Generating proto from operations...';
    const result = compileOperationsToProto(operations, enhancedSchema, {
        serviceName,
        packageName,
        goPackage,
        lockData,
        markQueriesIdempotent,
    });

    return {
        proto: result.proto,
        lockData: result.lockData,
    };
}

/**
 * Load all GraphQL operation files from a directory
 */
async function loadOperations(collectionDir: string, spinner: Ora): Promise<OperationInfo[]> {
    const files = await readdir(collectionDir);
    const operations: OperationInfo[] = [];

    for (const file of files) {
        const filePath = resolve(collectionDir, file);
        const ext = extname(file).toLowerCase();

        // Only process .graphql and .gql files
        if (ext === '.graphql' || ext === '.gql') {
            spinner.text = `Reading operation: ${file}`;
            const content = await readFile(filePath, 'utf8');
            const name = file.replace(/\.(graphql|gql)$/i, '');

            operations.push({
                name,
                content,
                filePath,
            });
        }
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
