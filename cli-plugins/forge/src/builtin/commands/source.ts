import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { failWith, toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import type { Command } from 'commander';
import { configFileName, lockFileName } from '@wundergraph/wgc-plugin-sdk/config';
import { localModuleName } from '../catalog.js';
import { generateProtoSource, generateSource, sourceFiles, writeSourceModule } from '../source/generate.js';
import type { GeneratedSource } from '../source/generate.js';
import { openApiTitle, readOpenApi } from '../source/openapi.js';
import { readProto } from '../source/proto.js';
import { parseRenames, renameProtoSource, renameSource } from '../source/rename.js';
import type { Rename } from '../source/rename.js';
import type { Skipped } from '../source/model.js';
import { sameSource } from '../sources.js';
import type { System } from '../system.js';
import { modulesDirectory, readLock, readRouterWorkspace, writeConfig } from '../workspace.js';
import { withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

interface SourceAddOptions extends CommonOptions {
  name?: string;
  listen: string;
  target?: string;
  servedFrom?: string;
  rename: string[];
}

const defaultListenAddr = '127.0.0.1:4011';
const moduleNamePattern = /^[a-z][\da-z-]*$/;

const isUrl = (source: string): boolean => /^https?:\/\//.test(source);

/** The kinds of source Forge cannot turn into a subgraph, each with what is missing. */
const unsupportedSource = (source: string): Result<string> | undefined => {
  if (/^postgres(ql)?:\/\//.test(source)) {
    return failWith({
      message:
        'A Postgres database cannot become a subgraph yet. Forge does not read a database schema, and the module it generates answers fields from a REST API or a gRPC service, not from SQL.',
      input: 'postgres source',
      remediation:
        'Add the OpenAPI 3 description of a REST API, or the proto file of a gRPC service, in front of the database instead.',
    });
  }

  return undefined;
};

const isProto = (source: string): boolean => new URL(source, 'file:///').pathname.endsWith('.proto');

const readSource = async (system: System, invokedFrom: string, source: string): Promise<Result<string>> => {
  const unsupported = unsupportedSource(source);
  if (unsupported !== undefined) {
    return unsupported;
  }

  if (isUrl(source)) {
    const response = await system.fetchText(source);
    if (response.status !== 200) {
      return failWith({
        message:
          response.status === 0
            ? `${source} could not be downloaded: ${response.body}`
            : `${source} answered with status ${response.status}.`,
        input: source,
        remediation:
          'Check the URL and that it can be read without signing in, or download the description and pass the file.',
      });
    }
    return { success: true, data: response.body };
  }

  try {
    return { success: true, data: await readFile(path.resolve(invokedFrom, source), 'utf8') };
  } catch {
    return failWith({
      message: `${source} is not a file or an http(s) URL.`,
      input: source,
      remediation: 'Pass the URL or path of an OpenAPI 3 description or a proto file.',
    });
  }
};

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '-')
    .replaceAll(/^[\d-]+|-+$/g, '');

/** A description read as the graph it becomes, before it is generated under a name. */
interface DescribedSource {
  kind: 'openapi' | 'proto';
  defaultName: string;
  operations: { field: string; request: string }[];
  skipped: Skipped[];
  generate: (name: string, listenAddr: string) => Result<GeneratedSource>;
}

const describeSource = (params: {
  text: string;
  location: string;
  target: string;
  servedFrom: string | undefined;
  renames: Rename[];
}): Result<DescribedSource> => {
  const { text, location, target, servedFrom, renames } = params;

  if (isProto(location)) {
    const read = readProto(text, location);
    if (!read.success) {
      return read;
    }
    const model = renameProtoSource(read.data, renames);
    if (!model.success) {
      return model;
    }
    return {
      success: true,
      data: {
        kind: 'proto',
        defaultName: slug(model.data.serviceName.replace(/Service$/, '')),
        operations: model.data.operations.map((operation) => ({
          field: `${operation.root}.${operation.field}`,
          request: operation.method,
        })),
        skipped: model.data.skipped,
        generate: (name, listenAddr) =>
          generateProtoSource({ model: model.data, name, listenAddr, target, upstreamProto: text }),
      },
    };
  }

  const read = readOpenApi(text, location, servedFrom ?? (isUrl(location) ? location : undefined));
  if (!read.success) {
    return read;
  }
  const model = renameSource(read.data, renames);
  if (!model.success) {
    return model;
  }
  return {
    success: true,
    data: {
      kind: 'openapi',
      defaultName: slug(openApiTitle(text) ?? ''),
      operations: model.data.operations.map((operation) => ({
        field: operation.field,
        request: `${operation.method} ${operation.path}`,
      })),
      skipped: model.data.skipped,
      generate: (name, listenAddr) => generateSource({ model: model.data, name, listenAddr }),
    },
  };
};

export const registerSource = (command: Command, dependencies: ForgeDependencies): void => {
  const source = command.command('source').description('Bring an existing API into the graph.');

  withCommonOptions(
    source
      .command('add')
      .description(
        'Generate a Cosmo Connect subgraph from an OpenAPI 3 description or a gRPC proto file and register it as a module that `wgc forge build` compiles into the router.',
      )
      .argument('<source>', 'The URL or path of an OpenAPI 3 description (JSON or YAML) or of a .proto file.')
      .option(
        '--name <name>',
        'The module and subgraph name. Defaults to the title of the API or the name of the service.',
      )
      .option('--listen <address>', 'Where the router serves the subgraph to itself.', defaultListenAddr)
      .option(
        '--target <address>',
        'For a proto file: the address of the gRPC service, such as dns:///payroll:50051. The router config can set it instead.',
      )
      .option(
        '--served-from <url>',
        'For an OpenAPI file: the URL the description was downloaded from. A relative server URL in it, such as /api/v3, is resolved against this URL.',
      )
      .option(
        '--rename <coordinate=name>',
        'Renames a generated type, such as Salary=PayrollSalary, or root field, such as Query.salary=payrollSalary. Repeatable.',
        (value: string, previous: string[]) => [...previous, value],
        [],
      )
      .addHelpText(
        'after',
        [
          '',
          'From an OpenAPI description, every GET operation with a JSON response becomes a query field. From a proto',
          'file, every unary RPC becomes a field: on Query when its name starts with a reading verb such as Get or',
          'List, or when it has no side effects, and on Mutation otherwise. The module runs inside the router',
          'process: it serves the subgraph on --listen and the router reaches it there as a gRPC subgraph, so',
          `there is no plugin executable and no bridge service. The subgraph is added to ${configFileName} as a`,
          'grpc subgraph next to the module. --rename changes only GraphQL names, and the module still calls the',
          'same REST operations or RPCs with the same fields. Postgres URLs are not supported yet.',
        ].join('\n'),
      ),
  ).action(async (location: string, options: SourceAddOptions) => {
    const { system, context } = dependencies;
    const output = context.output({ json: options.json });
    const workspace = workspaceOf(dependencies, options);

    const read = await readRouterWorkspace(workspace);
    if (!read.success) {
      return output.fail(toFailure(read));
    }
    const { config, router } = read.data;
    const lock = await readLock(workspace);
    if (!lock.success) {
      return output.fail(toFailure(lock));
    }
    if (lock.data === undefined) {
      return output.fail({
        message: `The workspace has no ${lockFileName}, so the router version the module builds against is unknown.`,
        input: lockFileName,
        remediation: 'Run `wgc forge lock` first.',
      });
    }

    const renames = parseRenames(options.rename);
    if (!renames.success) {
      return output.fail(toFailure(renames));
    }

    output.progress({ step: 'read-source', subject: location, message: 'Reading the API description' });
    const text = await readSource(system, dependencies.cwd(), location);
    if (!text.success) {
      return output.fail(toFailure(text));
    }
    const described = describeSource({
      text: text.data,
      location,
      target: options.target ?? '',
      servedFrom: options.servedFrom,
      renames: renames.data,
    });
    if (!described.success) {
      return output.fail(toFailure(described));
    }

    const name = options.name ?? described.data.defaultName;
    if (!moduleNamePattern.test(name)) {
      return output.fail({
        message: `"${name}" is not a valid module name.`,
        input: options.name === undefined ? 'the name of the API' : `--name ${name}`,
        remediation:
          'Pass --name with lowercase letters, digits and dashes, starting with a letter, for example --name catalog.',
      });
    }

    const routingUrl = `dns:///${options.listen}`;
    if (config.subgraphs.some((subgraph) => subgraph.name === name)) {
      return output.fail({
        message: `${configFileName} already has a subgraph named ${name}.`,
        input: `--name ${name}`,
        remediation: 'Pass another --name.',
      });
    }
    if (config.subgraphs.some((subgraph) => subgraph.kind !== 'plugin' && subgraph.routing_url === routingUrl)) {
      return output.fail({
        message: `Another subgraph in ${configFileName} is already served on ${options.listen}.`,
        input: `--listen ${options.listen}`,
        remediation: 'Pass --listen with a free address, for example --listen 127.0.0.1:4012.',
      });
    }

    output.progress({ step: 'generate', subject: name, message: 'Generating the schema, proto and mapping' });
    const generated = described.data.generate(name, options.listen);
    if (!generated.success) {
      return output.fail(toFailure(generated));
    }

    const written = await writeSourceModule({ workspace, name, router: lock.data.router, generated: generated.data });
    if (!written.success) {
      return output.fail(toFailure(written));
    }

    const moduleSource = { path: written.data };
    const modules = router.modules.some((module) => sameSource(module, moduleSource))
      ? router.modules
      : [...router.modules, moduleSource];
    const fileInModule = (file: string): string => path.posix.join(modulesDirectory, name, file);
    await writeConfig(workspace, {
      ...config,
      subgraphs: [
        ...config.subgraphs,
        {
          name,
          kind: 'grpc',
          schema: { file: fileInModule(sourceFiles.schema) },
          proto: fileInModule(sourceFiles.proto),
          mapping: fileInModule(sourceFiles.mapping),
          routing_url: routingUrl,
        },
      ],
      router: { ...router, modules },
    });

    output.result(
      {
        source: { kind: described.data.kind, location },
        module: { id: name, path: written.data, package: localModuleName(name) },
        subgraph: {
          name,
          routingUrl,
          schema: `${written.data}/${sourceFiles.schema}`,
          proto: `${written.data}/${sourceFiles.proto}`,
          mapping: `${written.data}/${sourceFiles.mapping}`,
          sdl: generated.data.sdl,
        },
        operations: described.data.operations,
        skipped: described.data.skipped,
        execution: { process: 'router', transport: 'grpc over loopback tcp', listenAddr: options.listen },
      },
      (data) =>
        [
          `Created ${data.module.path} from ${location} and added the module and the subgraph to ${configFileName}.`,
          `  ${data.operations.length} field(s)`,
          ...data.operations.map((operation) => `    ${operation.field}  ${operation.request}`),
          `  ${data.skipped.length} skipped`,
          ...data.skipped.map((skipped) => `    ${skipped.subject}: ${skipped.reason}`),
          `  The router serves the subgraph to itself on ${options.listen}. No plugin executable is started.`,
          'Next: `wgc forge build`.',
        ].join('\n'),
    );
  });
};
