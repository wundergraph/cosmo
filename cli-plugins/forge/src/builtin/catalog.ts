import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { failWith } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import type { LockedRouter } from './lock.js';
import { routerModule } from './resolve.js';
import { modulesDirectory } from './workspace.js';

export interface CatalogEntry {
  id: string;
  kind: 'preset' | 'template';
  description: string;
  /** Builds on a router hook that may still change; creating it needs `--experimental`. */
  experimental?: true;
}

/**
 * Presets are finished modules. Templates are one empty hook each, covering requests and middleware,
 * origin requests and responses, tracing, and subscriptions and streams.
 */
export const catalog: CatalogEntry[] = [
  {
    id: 'request-id',
    kind: 'preset',
    description: 'Answers every request with exactly one non-empty X-Request-ID header.',
  },
  {
    id: 'client-name',
    kind: 'preset',
    description: 'Rejects requests that do not send the client name header (modules.clientName.header).',
  },
  {
    id: 'router-request',
    kind: 'template',
    description: 'Runs on every request before tracing, authentication and operation parsing.',
  },
  {
    id: 'operation-middleware',
    kind: 'template',
    description: 'Runs once the GraphQL operation is parsed and planned.',
  },
  { id: 'origin-request', kind: 'template', description: 'Runs before each request to a subgraph.' },
  { id: 'origin-response', kind: 'template', description: 'Runs after each response from a subgraph.' },
  { id: 'tracing', kind: 'template', description: 'Names the router spans or adds a tracing convention.' },
  {
    id: 'stream-receive',
    kind: 'template',
    description: 'Filters or changes broker events before they reach subscribers.',
  },
  {
    id: 'subscription-start',
    kind: 'template',
    description: 'Checks a subscription when a client starts it. Experimental: needs --experimental.',
    experimental: true,
  },
];

const catalogDirectory = fileURLToPath(new URL('../../gomodules', import.meta.url));

const moduleNamePattern = /^[a-z][\da-z-]*$/;

export const localModuleName = (name: string): string => `forge.local/${name}`;

const exists = async (target: string): Promise<boolean> => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

/**
 * Copies a preset or template into `modules/<name>` as its own Go module that requires the pinned router.
 * Returns the module's path relative to the workspace.
 */
export const createModule = async ({
  workspace,
  entry,
  name,
  router,
}: {
  workspace: string;
  entry: CatalogEntry;
  name: string;
  router: LockedRouter;
}): Promise<Result<string>> => {
  if (!moduleNamePattern.test(name)) {
    return failWith({
      message: `"${name}" is not a valid module name.`,
      input: name,
      remediation: 'Use lowercase letters, digits and dashes, starting with a letter, for example rate-limit.',
    });
  }

  const relativePath = `./${modulesDirectory}/${name}`;
  const target = path.join(workspace, modulesDirectory, name);
  if (await exists(target)) {
    return failWith({
      message: `${relativePath} already exists.`,
      input: relativePath,
      remediation: 'Pick another name, or delete the directory to create the module again.',
    });
  }

  const source = path.join(catalogDirectory, entry.kind === 'preset' ? 'presets' : 'templates', entry.id);
  await mkdir(target, { recursive: true });
  for (const file of await readdir(source)) {
    if (entry.kind === 'preset') {
      await cp(path.join(source, file), path.join(target, file));
      continue;
    }
    const code = await readFile(path.join(source, file), 'utf8');
    await writeFile(
      path.join(target, file),
      code.replace(`const moduleID = "${entry.id}"`, `const moduleID = "${name}"`),
    );
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
