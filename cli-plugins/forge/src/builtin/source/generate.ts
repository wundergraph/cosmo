import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { compileGraphQLToMapping, compileGraphQLToProto, validateGraphQLSDL } from '@wundergraph/protographic';
import { localModuleName } from '../catalog.js';
import { fail } from '../failure.js';
import type { LockedRouter } from '../lock.js';
import { routerModule } from '../resolve.js';
import { modulesDirectory } from '../workspace.js';
import { pascalName, renderSdl } from './model.js';
import type { SourceModel } from './model.js';

const templateDirectory = fileURLToPath(new URL('../../../gomodules/sources/rest', import.meta.url));

/** The Go files of the template. Its data files are generated, and its other tests are about its own sample API. */
const templateFiles = ['module.go', 'service.go', 'rest.go', 'operations_test.go'];
const templateModuleId = 'rest-source';

export const sourceFiles = {
  schema: 'schema.graphql',
  proto: 'generated/service.proto',
  mapping: 'generated/mapping.json',
  operations: 'operations.json',
};

export interface GeneratedSource {
  sdl: string;
  proto: string;
  mapping: string;
  /** How each RPC maps to the REST API, read by the module at startup. */
  operations: string;
}

/** Generates the Cosmo Connect contract of the graph with protographic, and the REST call behind each RPC. */
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

  const validation = validateGraphQLSDL(sdl);
  if (validation.errors.length > 0) {
    return fail({
      message: `The schema generated for ${name} cannot be served over Cosmo Connect:\n${validation.errors.join('\n')}`,
      input: name,
    });
  }

  const serviceName = `${pascalName(name)}Service`;
  const { proto } = compileGraphQLToProto(sdl, { serviceName, packageName: `${name.replaceAll('-', '_')}.v1` });
  const mapping = compileGraphQLToMapping(sdl, serviceName);

  const fieldsOf = (type: string) =>
    mapping.typeFieldMappings.find((candidate) => candidate.type === type)?.fieldMappings ?? [];

  const operations = model.operations.map((operation) => {
    const rpc = mapping.operationMappings.find((candidate) => candidate.original === operation.field)?.mapped;
    const queryField = fieldsOf('Query').find((candidate) => candidate.original === operation.field);

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
          fieldsOf(type.name).find((candidate) => candidate.original === field.name)?.mapped,
        ]),
      ),
    ]),
  );

  return {
    success: true,
    data: {
      sdl,
      proto,
      mapping: `${JSON.stringify(mapping, null, 2)}\n`,
      operations: `${JSON.stringify({ baseUrl: model.baseUrl ?? '', listenAddr, operations, types }, null, 2)}\n`,
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
 * subgraph inside the router, and the generated contract it reads. Returns the path relative to the workspace.
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
    return fail({
      message: `${relativePath} already exists.`,
      input: relativePath,
      fix: 'Pass another --name, or delete the directory to generate the source again.',
    });
  }

  await mkdir(path.join(target, 'generated'), { recursive: true });

  for (const file of templateFiles) {
    if (file !== 'module.go') {
      await cp(path.join(templateDirectory, file), path.join(target, file));
      continue;
    }

    const code = await readFile(path.join(templateDirectory, file), 'utf8');
    await writeFile(
      path.join(target, file),
      code.replace(`const moduleID = "${templateModuleId}"`, `const moduleID = "${name}"`),
    );
  }

  await writeFile(path.join(target, sourceFiles.schema), generated.sdl);
  await writeFile(path.join(target, sourceFiles.proto), generated.proto);
  await writeFile(path.join(target, sourceFiles.mapping), generated.mapping);
  await writeFile(path.join(target, sourceFiles.operations), generated.operations);

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
