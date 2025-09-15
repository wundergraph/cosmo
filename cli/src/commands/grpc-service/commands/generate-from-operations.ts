import { access, constants, lstat, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import {
    compileOperationsToProto,
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
    operations: string;
    output: string;
    packageName?: string;
    goPackage?: string;
    protoLock?: string;
};

export default (opts: BaseCommandOptions) => {
    const command = new Command('generate-from-operations');
    command.description('Generate a protobuf schema from GraphQL operations.');
    command.argument('[name]', 'The name of the proto service.');
    command.requiredOption('-s, --schema <path-to-schema>', 'The GraphQL schema file.');
    command.requiredOption('-o, --operations <path-to-operations>', 'The directory containing GraphQL operation files.');
    command.option('--output <path-to-output>', 'The output directory for the protobuf schema. (default ".").', '.');
    command.option('-p, --package-name <name>', 'The name of the proto package. (default "service.v1")', 'service.v1');
    command.option('-g, --go-package <name>', 'Adds an `option go_package` to the proto file.');
    command.option(
        '-l, --proto-lock <path-to-proto-lock>',
        'The path to the existing proto lock file to use as the starting point for the updated proto lock file. ' +
        'Default is to use and overwrite the output file "<outdir>/service.proto.lock.json".',
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
        const operationsDir = resolve(options.operations);

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

        if (!(await exists(operationsDir))) {
            program.error(`Operations directory ${options.operations} does not exist`);
        }

        const result = await generateProtoFromOperations({
            outdir: options.output,
            schemaFile,
            operationsDir,
            name,
            spinner,
            packageName: options.packageName,
            goPackage: options.goPackage,
            lockFile: options.protoLock,
        });

        // Write the generated files
        await writeFile(resolve(options.output, 'service.proto'), result.proto);
        if (result.lockData) {
            await writeFile(resolve(options.output, 'service.proto.lock.json'), JSON.stringify(result.lockData, null, 2));
        }

        renderResultTree(spinner, 'Generated protobuf schema from operations', true, name, {
            'schema file': schemaFile,
            'operations dir': operationsDir,
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
    operationsDir: string;
    spinner: Ora;
    packageName?: string;
    goPackage?: string;
    lockFile?: string;
};

/**
 * Generate proto from operations and schema
 */
async function generateProtoFromOperations({
                                               name,
                                               outdir,
                                               schemaFile,
                                               operationsDir,
                                               spinner,
                                               packageName,
                                               goPackage,
                                               lockFile = resolve(outdir, 'service.proto.lock.json'),
                                           }: GenerationOptions): Promise<GenerationResult> {
    spinner.text = 'Reading schema and operations...';

    const schema = await readFile(schemaFile, 'utf8');
    const serviceName = upperFirst(camelCase(name)) + 'Service';

    // Read all GraphQL operation files
    const operations = await loadOperations(operationsDir, spinner);

    if (operations.length === 0) {
        throw new Error('No GraphQL operation files found in the operations directory');
    }

    spinner.text = `Found ${operations.length} operation(s)...`;

    const lockData = await fetchLockData(lockFile);

    // Validate the GraphQL schema and render results
    spinner.text = 'Validating GraphQL schema...';
    const validationResult = validateGraphQLSDL(schema);
    renderValidationResults(validationResult, schemaFile);

    // Generate proto from operations
    spinner.text = 'Generating proto from operations...';
    const result = compileOperationsToProto(operations, schema, {
        serviceName,
        packageName,
        goPackage,
        lockData,
    });

    return {
        proto: result.proto,
        lockData: result.lockData,
    };
}

/**
 * Load all GraphQL operation files from a directory
 */
async function loadOperations(operationsDir: string, spinner: Ora): Promise<OperationInfo[]> {
    const files = await readdir(operationsDir);
    const operations: OperationInfo[] = [];

    for (const file of files) {
        const filePath = resolve(operationsDir, file);
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
