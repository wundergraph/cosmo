import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { ok } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { actionable } from './failure.js';

export const sandboxFileName = 'sandbox.yaml';

export const defaultAudience = 'hub';

const jsonObject = z.record(z.string(), z.json());

const subgraphEntry = z
  .strictObject({
    name: z
      .string({ error: 'set `name` to the subgraph name, e.g. `name: products`' })
      .regex(/^[\dA-Za-z][\w-]*$/, 'use letters, digits, `-` and `_` only, e.g. `name: products`'),
    schema: z.string({ error: 'set `schema` to the path of an SDL file' }).min(1).optional(),
    generate: z.string({ error: 'set `generate` to a command that prints the SDL' }).min(1).optional(),
    url: z.url({ error: 'set `url` to the subgraph URL, e.g. `url: https://products.example.com/graphql`' }).optional(),
  })
  .refine((entry) => (entry.schema === undefined) !== (entry.generate === undefined), {
    message: 'set exactly one of `schema` (a path to an SDL file) or `generate` (a command that prints the SDL)',
  })
  .transform(({ name, schema, generate, url }): SandboxSubgraph => {
    const source: SubgraphSource =
      generate === undefined ? { kind: 'file', path: schema ?? '' } : { kind: 'command', command: generate };
    return { name, source, url };
  });

const routerSource = z.union(
  [
    z.strictObject({ release: z.string().min(1) }),
    z.strictObject({ rc: z.string().min(1) }),
    z.strictObject({ commit: z.string().min(1) }),
  ],
  { error: 'set exactly one of `release: <version>`, `rc: <tag>` or `commit: <sha>`' },
);

const routerModule = z.union([z.string().min(1), z.record(z.string(), z.string())], {
  error: 'list each module as a string or a map of strings',
});

const mockValue = z.union([jsonObject, z.array(jsonObject)], {
  error: 'give each type a map of `<field>: value` or a list of such maps',
});

const sandboxConfigSchema = z.strictObject({
  schema: z.string({ error: 'set `schema` to the Hub schema slug, e.g. `schema: shop`' }).min(1),
  audience: z.string().min(1).optional(),
  subgraphs: z
    .array(subgraphEntry, { error: 'list the subgraphs under `subgraphs:`, each with a `name`' })
    .min(1, 'list at least one subgraph under `subgraphs:`'),
  router: z
    .strictObject({
      source: routerSource.optional(),
      modules: z.array(routerModule).optional(),
    })
    .optional(),
  collections: z.string({ error: 'set `collections` to a glob, e.g. `collections: "collections/**"`' }).optional(),
  mocks: z.record(z.string(), mockValue).optional(),
});

export type SubgraphSource = { kind: 'file'; path: string } | { kind: 'command'; command: string };

export interface SandboxSubgraph {
  name: string;
  source: SubgraphSource;
  url?: string;
}

export type SandboxConfig = z.output<typeof sandboxConfigSchema>;

export interface LoadedSandboxConfig {
  config: SandboxConfig;
  /** The file's exact text; Hub reads `mocks` and `router` from it. */
  raw: string;
  /** Directory relative paths and `generate` commands resolve against. */
  dir: string;
  path: string;
}

const formatPath = (issuePath: PropertyKey[]): string => {
  let formatted = '';
  for (const key of issuePath) {
    if (typeof key === 'number') {
      formatted += `[${key}]`;
    } else {
      formatted += formatted === '' ? String(key) : `.${String(key)}`;
    }
  }
  return formatted;
};

export const parseSandboxConfig = (raw: string, filePath: string): Result<SandboxConfig> => {
  let document: z.core.util.JSONType;
  try {
    document = z.json().parse(yaml.load(raw, { schema: yaml.JSON_SCHEMA }));
  } catch (error) {
    return actionable(
      `${filePath} is not valid YAML: ${(error as Error).message.split('\n')[0]}`,
      `Fix the YAML syntax in ${filePath}.`,
      filePath,
    );
  }

  const parsed = sandboxConfigSchema.safeParse(document);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `  ${formatPath(issue.path) || '(top level)'}: ${issue.message}`,
    );
    return actionable(
      `${filePath} is invalid:\n${problems.join('\n')}`,
      `Edit ${filePath} at the paths above and rerun.`,
      filePath,
    );
  }
  return ok(parsed.data);
};

export const loadSandboxConfig = async (configPath: string): Promise<Result<LoadedSandboxConfig>> => {
  const absolutePath = path.resolve(configPath);
  let raw: string;
  try {
    raw = await readFile(absolutePath, 'utf8');
  } catch {
    return actionable(
      `No ${path.basename(configPath)} at ${absolutePath}.`,
      'Run `wgc hub init` to create one, or pass `--config <path>`.',
      configPath,
    );
  }

  const parsed = parseSandboxConfig(raw, configPath);
  if (!parsed.success) {
    return parsed;
  }
  return ok({ config: parsed.data, raw, dir: path.dirname(absolutePath), path: absolutePath });
};
