import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { failWith, ok } from './result.js';
import type { Result } from './result.js';

/** The one repository config that wgc, its plugins and Hub read and write. */
export const configFileName = 'wundergraph.yaml';

/** What `wgc forge lock` pins for the `router` section of wundergraph.yaml. Generated, never edited by hand. */
export const lockFileName = 'wundergraph.lock';

export const defaultRouterBinary = '.forge/bin/router';

const name = z
  .string({ error: 'set `name`, e.g. `name: products`' })
  .regex(/^[\dA-Za-z][\w-]*$/, 'use letters, digits, `-` and `_` only, e.g. `name: products`');

const relativePath = z.string({ error: 'set a path relative to wundergraph.yaml' }).min(1);

const fileSource = z.strictObject({ file: relativePath });

const commandSource = z.strictObject({
  command: z.string({ error: 'set `command` to a command that prints the SDL' }).min(1),
});

const schemaSource = z.union([fileSource, commandSource], {
  error: 'set `schema` to `{ file: <path to an SDL file> }` or `{ command: <command that prints the SDL> }`',
});

const routingUrl = z.string({ error: 'set `routing_url` to where the router reaches the subgraph' }).min(1);

const subscription = z.strictObject({
  url: z.string().min(1).optional(),
  protocol: z.enum(['ws', 'sse', 'sse_post']).optional(),
  websocket_subprotocol: z.enum(['auto', 'graphql-ws', 'graphql-transport-ws']).optional(),
});

const schemaSubgraph = z.strictObject({
  name,
  kind: z.literal('schema'),
  schema: schemaSource,
  routing_url: routingUrl.optional(),
  subscription: subscription.optional(),
});

const grpcSubgraph = z.strictObject({
  name,
  kind: z.literal('grpc'),
  schema: fileSource,
  proto: relativePath,
  mapping: relativePath,
  routing_url: routingUrl,
});

const semverVersion = z.string().regex(/^\d+\.\d+\.\d+(-[\w.-]+)?$/, 'must be a semantic version such as 0.0.1');

const pluginSubgraph = z
  .strictObject({
    name,
    kind: z.literal('plugin'),
    path: relativePath,
    version: semverVersion,
  })
  .refine((plugin) => path.posix.basename(plugin.path) === plugin.name, {
    error: 'name a plugin subgraph after its directory, as the router loads it by that name',
  });

/** An entry without `kind` is a GraphQL subgraph whose SDL comes from `schema`. */
const withDefaultKind = (entry: unknown): unknown =>
  typeof entry === 'object' && entry !== null && !Array.isArray(entry) && !('kind' in entry)
    ? { ...entry, kind: 'schema' }
    : entry;

const subgraph = z.preprocess(
  withDefaultKind,
  z.discriminatedUnion('kind', [schemaSubgraph, grpcSubgraph, pluginSubgraph], {
    error: 'set `kind` to schema, grpc or plugin',
  }),
);

const featureGraph = z.strictObject({
  name,
  subgraph_name: name,
  schema: schemaSource,
  routing_url: routingUrl,
  subscription: subscription.optional(),
});

const featureFlag = z.strictObject({
  name: z.string().min(1),
  feature_graphs: z.array(featureGraph).min(1, 'list at least one feature graph'),
});

const releaseVersion = z.string().regex(/^\d+\.\d+\.\d+$/, 'must be a router release version such as 0.299.0');

const releaseCandidateVersion = z
  .string()
  .regex(/^\d+\.\d+\.\d+-[\w.-]+$/, 'must be a router release candidate version such as 0.300.0-rc.1');

const commitSha = z.string().regex(/^[\da-f]{7,40}$/, 'must be a commit SHA of 7 to 40 hex characters');

export const routerSourceSchema = z.union(
  [
    z.strictObject({ release: releaseVersion }),
    z.strictObject({ rc: releaseCandidateVersion }),
    z.strictObject({ commit: commitSha }),
  ],
  { error: 'must be exactly one of { release: <version> }, { rc: <version> } or { commit: <sha> }' },
);

export const localModuleSourceSchema = z.strictObject({ path: relativePath });

export const goModuleSourceSchema = z.strictObject({ go: z.string().min(1), version: z.string().min(1).optional() });

export const gitModuleSourceSchema = z.strictObject({
  git: z.string().min(1),
  ref: z.string().min(1).optional(),
  package: z.string().min(1).optional(),
});

export const remoteModuleSourceSchema = z.union([goModuleSourceSchema, gitModuleSourceSchema]);

export const moduleSourceSchema = z.union([localModuleSourceSchema, goModuleSourceSchema, gitModuleSourceSchema], {
  error:
    'must be one of { path: <directory> }, { go: <package>, version?: <version> } or { git: <url>, ref?: <ref>, package?: <directory> }',
});

const routerSection = z
  .strictObject({
    release: releaseVersion.optional(),
    rc: releaseCandidateVersion.optional(),
    commit: commitSha.optional(),
    modules: z.array(moduleSourceSchema).default([]),
    binary: relativePath.default(defaultRouterBinary),
    test: z.string().min(1).optional(),
  })
  .transform(({ release, rc, commit, modules, binary, test }, context) => {
    const sources: RouterSource[] = [
      ...(release === undefined ? [] : [{ release }]),
      ...(rc === undefined ? [] : [{ rc }]),
      ...(commit === undefined ? [] : [{ commit }]),
    ];
    const [source] = sources;
    if (sources.length !== 1 || source === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'set exactly one of `release: <version>`, `rc: <version>` or `commit: <sha>`',
      });
      return z.NEVER;
    }
    return { source, modules, binary, ...(test === undefined ? {} : { test }) };
  });

/** The team's API design policy for `wgc forge check`: which rules block, and approved exceptions. */
export const checkPolicySchema = z.strictObject({
  rules: z.record(z.string(), z.enum(['error', 'warn', 'off'])).optional(),
  exceptions: z
    .array(z.strictObject({ rule: z.string().min(1), coordinate: z.string().min(1), reason: z.string().min(1) }))
    .optional(),
});

const jsonObject = z.record(z.string(), z.json());

const mock = z.union([jsonObject, z.array(jsonObject)], {
  error: 'give each type a map of `<field>: value` or a list of such maps',
});

const uniqueNames = (entries: ReadonlyArray<{ name: string }>): boolean =>
  new Set(entries.map((entry) => entry.name)).size === entries.length;

export const configSchema = z.strictObject({
  graph: z
    .string({ error: 'set `graph` to the federated graph in Cosmo, e.g. `graph: shop`' })
    .regex(/^[\dA-Za-z][\w-]*$/, 'use letters, digits, `-` and `_` only, e.g. `graph: shop`'),
  namespace: z
    .string({ error: 'set `namespace` to the Cosmo namespace, e.g. `namespace: default`' })
    .regex(/^[\dA-Za-z][\w-]*$/, 'use letters, digits, `-` and `_` only, e.g. `namespace: default`')
    .default('default'),
  subgraphs: z
    .array(subgraph, { error: 'list the subgraphs under `subgraphs:`, each with a `name`' })
    .default([])
    .refine(uniqueNames, { error: 'give every subgraph its own name' }),
  feature_flags: z.array(featureFlag).optional(),
  router: routerSection.optional(),
  check: checkPolicySchema.optional(),
  mocks: z.record(z.string(), mock).optional(),
  collections: z.string({ error: 'set `collections` to a glob, e.g. `collections: "collections/*"`' }).optional(),
});

export type SchemaSource = z.infer<typeof schemaSource>;
export type SchemaSubgraph = z.infer<typeof schemaSubgraph>;
export type GrpcSubgraph = z.infer<typeof grpcSubgraph>;
export type PluginSubgraph = z.infer<typeof pluginSubgraph>;
export type Subgraph = SchemaSubgraph | GrpcSubgraph | PluginSubgraph;
export type FeatureFlag = z.infer<typeof featureFlag>;
export type RouterSource = z.infer<typeof routerSourceSchema>;
export type LocalModuleSource = z.infer<typeof localModuleSourceSchema>;
export type GoModuleSource = z.infer<typeof goModuleSourceSchema>;
export type GitModuleSource = z.infer<typeof gitModuleSourceSchema>;
export type RemoteModuleSource = z.infer<typeof remoteModuleSourceSchema>;
export type ModuleSource = z.infer<typeof moduleSourceSchema>;
export type RouterConfig = z.output<typeof routerSection>;
export type CheckPolicy = z.infer<typeof checkPolicySchema>;
export type Mock = z.infer<typeof mock>;
export type WundergraphConfig = z.output<typeof configSchema>;

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

const loadYaml = <T>(text: string, fileName: string, schema: z.ZodType<T>): Result<T> => {
  let document: unknown;
  try {
    document = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  } catch (error) {
    return failWith({
      kind: 'usage',
      message: `${fileName} is not valid YAML: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`,
      remediation: `Fix the YAML syntax in ${fileName}.`,
      input: fileName,
    });
  }

  const parsed = schema.safeParse(document ?? {});
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `  ${formatPath(issue.path) || '(top level)'}: ${issue.message}`,
    );
    return failWith({
      kind: 'usage',
      message: `${fileName} is invalid:\n${problems.join('\n')}`,
      remediation: `Edit ${fileName} at the paths above and rerun.`,
      input: fileName,
    });
  }
  return ok(parsed.data);
};

/** Parses the text of a wundergraph.yaml. `fileName` names it in errors. */
export const parseConfig = (text: string, fileName: string = configFileName): Result<WundergraphConfig> =>
  loadYaml(text, fileName, configSchema);

const renderSubgraph = (entry: Subgraph): Record<string, unknown> => {
  if (entry.kind === 'schema') {
    const { kind: _kind, ...rest } = entry;
    return rest;
  }
  return { ...entry };
};

const renderRouter = (router: RouterConfig): Record<string, unknown> => ({
  ...router.source,
  ...(router.modules.length === 0 ? {} : { modules: router.modules }),
  ...(router.binary === defaultRouterBinary ? {} : { binary: router.binary }),
  ...(router.test === undefined ? {} : { test: router.test }),
});

/** Writes a config as wundergraph.yaml text, leaving out what equals its default. */
export const renderConfig = (config: WundergraphConfig): string => {
  const { graph, namespace, subgraphs, feature_flags: featureFlags, router, check, mocks, collections } = config;
  return yaml.dump(
    {
      graph,
      ...(namespace === 'default' ? {} : { namespace }),
      subgraphs: subgraphs.map((entry) => renderSubgraph(entry)),
      ...(featureFlags === undefined ? {} : { feature_flags: featureFlags }),
      ...(router === undefined ? {} : { router: renderRouter(router) }),
      ...(check === undefined ? {} : { check }),
      ...(collections === undefined ? {} : { collections }),
      ...(mocks === undefined ? {} : { mocks }),
    },
    { lineWidth: -1, noRefs: true },
  );
};

export interface LoadedConfig {
  config: WundergraphConfig;
  /** Absolute path of the wundergraph.yaml. */
  path: string;
  /** The directory every relative path and `command` in the file resolves against. */
  dir: string;
}

/** The wundergraph.yaml in `start` or the nearest parent directory. */
export const locateConfig = (start: string): string | undefined => {
  let directory = path.resolve(start);
  for (;;) {
    const candidate = path.join(directory, configFileName);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
};

/** Reads and parses the wundergraph.yaml at `configPath`. */
export const loadConfig = async (configPath: string): Promise<Result<LoadedConfig>> => {
  const absolutePath = path.resolve(configPath);
  let text: string;
  try {
    text = await readFile(absolutePath, 'utf8');
  } catch {
    return failWith({
      kind: 'usage',
      message: `No ${configFileName} at ${absolutePath}.`,
      remediation: `Create ${configFileName} at the repository root, or pass --config <path>.`,
      input: configPath,
    });
  }

  const parsed = parseConfig(text, configPath);
  if (!parsed.success) {
    return parsed;
  }
  return ok({ config: parsed.data, path: absolutePath, dir: path.dirname(absolutePath) });
};

export const writeConfig = async (configPath: string, config: WundergraphConfig): Promise<void> => {
  await writeFile(configPath, renderConfig(config));
};

/** The SDL file of a subgraph, relative to wundergraph.yaml. `undefined` when a command prints it. */
export const subgraphSchemaFile = (entry: Subgraph): string | undefined => {
  if (entry.kind === 'plugin') {
    return path.posix.join(entry.path, 'src', 'schema.graphql');
  }
  return 'file' in entry.schema ? entry.schema.file : undefined;
};

const fullCommit = z.string().regex(/^[\da-f]{40}$/, 'must be a full 40 character commit SHA');

export const lockedRouterSchema = z.strictObject({
  source: routerSourceSchema,
  commit: fullCommit,
  /** The Go module version of github.com/wundergraph/cosmo/router at that commit. */
  version: z.string().min(1),
  goVersion: z.string().min(1),
});

export const lockedModuleSchema = z.strictObject({
  source: remoteModuleSourceSchema,
  /** The Go module that contains the package. */
  module: z.string().min(1),
  /** The Go package the router imports. */
  package: z.string().min(1),
  version: z.string().min(1),
  commit: fullCommit.optional(),
});

export const lockSchema = z.strictObject({
  version: z.literal(1),
  router: lockedRouterSchema,
  modules: z.array(lockedModuleSchema).default([]),
});

export type LockedRouter = z.infer<typeof lockedRouterSchema>;
export type LockedModule = z.infer<typeof lockedModuleSchema>;
export type Lock = z.infer<typeof lockSchema>;

const lockHeader = `# Generated by \`wgc forge lock\` from the router section of ${configFileName}. Do not edit.\n`;

/** Parses the text of a wundergraph.lock. */
export const parseLock = (text: string, fileName: string = lockFileName): Result<Lock> =>
  loadYaml(text, fileName, lockSchema);

export const renderLock = (lock: Lock): string => `${lockHeader}${yaml.dump(lock, { lineWidth: -1 })}`;
