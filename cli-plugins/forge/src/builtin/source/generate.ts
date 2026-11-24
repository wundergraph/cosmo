import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { failWith } from '@wundergraph/wgc-plugin-sdk';
import { toJsonString } from '@bufbuild/protobuf';
import { GRPCMappingSchema } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import type { GRPCMapping } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { compileGraphQLToMapping, compileGraphQLToProto, validateGraphQLSDL } from '@wundergraph/protographic';
import type { LockedRouter } from '@wundergraph/wgc-plugin-sdk/config';
import { localModuleName } from '../catalog.js';
import { routerModule } from '../resolve.js';
import { modulesDirectory } from '../workspace.js';
import { pascalName, renderSdl } from './model.js';
import type { SourceModel } from './model.js';
import { renderProtoSdl } from './proto.js';
import type { ProtoSourceModel } from './proto.js';

/** The Go module each kind of source is served by, which Forge copies into the generated module. */
const templates = {
  rest: {
    directory: fileURLToPath(new URL('../../../gomodules/sources/rest', import.meta.url)),
    moduleId: 'rest-source',
    // Its data files are generated, and its other tests are about its own sample API.
    files: ['module.go', 'service.go', 'rest.go', 'operations_test.go'],
  },
  grpc: {
    directory: fileURLToPath(new URL('../../../gomodules/sources/grpc', import.meta.url)),
    moduleId: 'grpc-source',
    files: ['module.go', 'service.go', 'upstream.go', 'operations_test.go'],
  },
};

export type SourceTemplate = keyof typeof templates;

export const sourceFiles = {
  schema: 'schema.graphql',
  proto: 'generated/service.proto',
  mapping: 'generated/mapping.json',
  operations: 'operations.json',
  upstream: 'upstream.proto',
};

export interface GeneratedSource {
  template: SourceTemplate;
  sdl: string;
  /** The generated data files by path in the module: the contract, and how each RPC is answered. */
  files: Record<string, string>;
}

interface Contract {
  proto: string;
  mapping: GRPCMapping;
}

/** Compiles a subgraph schema to its Cosmo Connect contract with protographic. */
const compileContract = (sdl: string, name: string): Result<Contract> => {
  const validation = validateGraphQLSDL(sdl);
  if (validation.errors.length > 0) {
    return failWith({
      message: `The schema generated for ${name} cannot be served over Cosmo Connect:\n${validation.errors.join('\n')}`,
      input: name,
    });
  }

  const serviceName = `${pascalName(name)}Service`;
  const { proto } = compileGraphQLToProto(sdl, { serviceName, packageName: `${name.replaceAll('-', '_')}.v1` });
  return { success: true, data: { proto, mapping: compileGraphQLToMapping(sdl, serviceName) } };
};

const fieldsOf = (mapping: GRPCMapping, type: string) =>
  mapping.typeFieldMappings.find((candidate) => candidate.type === type)?.fieldMappings ?? [];

const contractFiles = (sdl: string, contract: Contract, operations: object): Record<string, string> => ({
  [sourceFiles.schema]: sdl,
  [sourceFiles.proto]: contract.proto,
  [sourceFiles.mapping]: `${toJsonString(GRPCMappingSchema, contract.mapping, { prettySpaces: 2 })}\n`,
  [sourceFiles.operations]: `${JSON.stringify(operations, null, 2)}\n`,
});

/** Generates the Cosmo Connect contract of a REST API's graph, and the REST call behind each RPC. */
export const generateSource = ({
  model,
  name,
  listenAddr,
}: {
  model: SourceModel;
  name: string;
  listenAddr: string;
}): Result<GeneratedSource> => {
  const sdl = renderSdl(model);
  const contract = compileContract(sdl, name);
  if (!contract.success) {
    return contract;
  }
  const { mapping } = contract.data;

  const operations = model.operations.map((operation) => {
    const rpc = mapping.operationMappings.find((candidate) => candidate.original === operation.field)?.mapped;
    const queryField = fieldsOf(mapping, 'Query').find((candidate) => candidate.original === operation.field);

    return {
      rpc,
      method: operation.method,
      path: operation.path,
      parameters: operation.parameters.map((parameter) => ({
        field: queryField?.argumentMappings.find((candidate) => candidate.original === parameter.argument)?.mapped,
        name: parameter.name,
        in: parameter.in,
      })),
    };
  });

  const types = Object.fromEntries(
    model.types.map((type) => [
      type.name,
      Object.fromEntries(
        type.fields.map((field) => [
          field.property,
          fieldsOf(mapping, type.name).find((candidate) => candidate.original === field.name)?.mapped,
        ]),
      ),
    ]),
  );

  return {
    success: true,
    data: {
      template: 'rest',
      sdl,
      files: contractFiles(sdl, contract.data, { baseUrl: model.baseUrl, listenAddr, operations, types }),
    },
  };
};

/**
 * Generates the Cosmo Connect contract of a gRPC service's graph, and which method of the service answers each
 * RPC. Field and enum names are mapped from the contract's names to the service's.
 */
export const generateProtoSource = ({
  model,
  name,
  listenAddr,
  target,
  upstreamProto,
}: {
  model: ProtoSourceModel;
  name: string;
  listenAddr: string;
  target: string;
  upstreamProto: string;
}): Result<GeneratedSource> => {
  const sdl = renderProtoSdl(model);
  const contract = compileContract(sdl, name);
  if (!contract.success) {
    return contract;
  }
  const { mapping } = contract.data;

  const renamed = (type: string, fields: { name: string; protoName: string }[]) =>
    Object.fromEntries(
      fields.map((field) => [
        fieldsOf(mapping, type).find((candidate) => candidate.original === field.name)?.mapped,
        field.protoName,
      ]),
    );

  const messages: Record<string, Record<string, string>> = {};
  const operations = model.operations.map((operation) => {
    const rpc = mapping.operationMappings.find(
      (candidate) => candidate.original === operation.field && candidate.mapped.startsWith(operation.root),
    );
    const rootField = fieldsOf(mapping, operation.root).find((candidate) => candidate.original === operation.field);
    if (rpc !== undefined) {
      messages[rpc.request] = Object.fromEntries(
        operation.arguments.map((argument) => [
          rootField?.argumentMappings.find((candidate) => candidate.original === argument.name)?.mapped,
          argument.protoName,
        ]),
      );
    }

    return {
      rpc: rpc?.mapped,
      method: operation.method,
      returns: operation.result.from,
      ...(operation.result.from === 'field' ? { field: operation.result.field } : {}),
    };
  });

  for (const type of [...model.types, ...model.inputs]) {
    messages[type.name] = renamed(type.name, type.fields);
  }

  const enums = Object.fromEntries(
    model.enums.map((type) => {
      const values = mapping.enumMappings.find((candidate) => candidate.type === type.name)?.values ?? [];
      return [
        type.name,
        Object.fromEntries(
          type.values.map((value) => [
            values.find((candidate) => candidate.original === value.name)?.mapped,
            value.protoName,
          ]),
        ),
      ];
    }),
  );

  return {
    success: true,
    data: {
      template: 'grpc',
      sdl,
      files: {
        ...contractFiles(sdl, contract.data, { target, listenAddr, operations, messages, enums }),
        [sourceFiles.upstream]: upstreamProto,
      },
    },
  };
};

const exists = async (target: string): Promise<boolean> => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

/**
 * Writes the source as a local module under `modules/<name>`: the template's Go code, which serves the
 * subgraph inside the router, and the generated files it reads. Returns the path relative to the workspace.
 */
export const writeSourceModule = async ({
  workspace,
  name,
  router,
  generated,
}: {
  workspace: string;
  name: string;
  router: LockedRouter;
  generated: GeneratedSource;
}): Promise<Result<string>> => {
  const relativePath = `./${modulesDirectory}/${name}`;
  const target = path.join(workspace, modulesDirectory, name);
  if (await exists(target)) {
    return failWith({
      message: `${relativePath} already exists.`,
      input: relativePath,
      remediation: 'Pass another --name, or delete the directory to generate the source again.',
    });
  }

  const template = templates[generated.template];
  await mkdir(path.join(target, 'generated'), { recursive: true });

  for (const file of template.files) {
    if (file !== 'module.go') {
      await cp(path.join(template.directory, file), path.join(target, file));
      continue;
    }

    const code = await readFile(path.join(template.directory, file), 'utf8');
    await writeFile(
      path.join(target, file),
      code.replace(`const moduleID = "${template.moduleId}"`, `const moduleID = "${name}"`),
    );
  }

  for (const [file, content] of Object.entries(generated.files)) {
    await writeFile(path.join(target, file), content);
  }

  const goMod = [
    `module ${localModuleName(name)}`,
    '',
    `go ${router.goVersion}`,
    '',
    `require ${routerModule} ${router.version}`,
  ];
  await writeFile(path.join(target, 'go.mod'), `${goMod.join('\n')}\n`);

  return { success: true, data: relativePath };
};
