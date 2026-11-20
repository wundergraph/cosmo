import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failWith } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import yaml from 'js-yaml';
import semver from 'semver';
import { z } from 'zod';

export const manifestFileName = 'forge.yaml';
export const defaultBinaryPath = '.forge/bin/router';

const releaseVersion = z
  .string()
  .refine((version) => semver.valid(version) !== null && semver.prerelease(version) === null, {
    error: 'must be a router release version such as 0.299.0',
  });

const releaseCandidateVersion = z
  .string()
  .refine((version) => semver.valid(version) !== null && semver.prerelease(version) !== null, {
    error: 'must be a router release candidate version such as 0.300.0-rc.1',
  });

const commitSha = z.string().regex(/^[\da-f]{7,40}$/, { error: 'must be a commit SHA of 7 to 40 hex characters' });

export const routerSourceSchema = z.union(
  [
    z.strictObject({ release: releaseVersion }),
    z.strictObject({ rc: releaseCandidateVersion }),
    z.strictObject({ commit: commitSha }),
  ],
  { error: 'must be exactly one of { release: <version> }, { rc: <version> } or { commit: <sha> }' },
);

export const localModuleSourceSchema = z.strictObject({ path: z.string().min(1) });

export const goModuleSourceSchema = z.strictObject({ go: z.string().min(1), version: z.string().min(1).optional() });

export const gitModuleSourceSchema = z.strictObject({
  git: z.string().min(1),
  ref: z.string().min(1).optional(),
  package: z.string().min(1).optional(),
});

export const remoteModuleSourceSchema = z.union([goModuleSourceSchema, gitModuleSourceSchema]);

const moduleSourceSchema = z.union([localModuleSourceSchema, goModuleSourceSchema, gitModuleSourceSchema], {
  error:
    'must be one of { path: <directory> }, { go: <package>, version?: <version> } or { git: <url>, ref?: <ref>, package?: <directory> }',
});

/** The team's API design policy for `wgc forge check`: where the graph is, which rules block, and approved exceptions. */
export const checkPolicySchema = z.strictObject({
  graph: z.string().min(1).optional(),
  rules: z.record(z.string(), z.enum(['error', 'warn', 'off'])).optional(),
  exceptions: z
    .array(
      z.strictObject({
        rule: z.string().min(1),
        coordinate: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .optional(),
});

export const manifestSchema = z.strictObject({
  version: z.literal(1),
  router: routerSourceSchema,
  binary: z.string().min(1).default(defaultBinaryPath),
  test: z.string().min(1).optional(),
  modules: z.array(moduleSourceSchema).default([]),
  check: checkPolicySchema.optional(),
});

export type RouterSource = z.infer<typeof routerSourceSchema>;
export type LocalModuleSource = z.infer<typeof localModuleSourceSchema>;
export type GoModuleSource = z.infer<typeof goModuleSourceSchema>;
export type GitModuleSource = z.infer<typeof gitModuleSourceSchema>;
export type RemoteModuleSource = z.infer<typeof remoteModuleSourceSchema>;
export type ModuleSource = z.infer<typeof moduleSourceSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type CheckPolicy = z.infer<typeof checkPolicySchema>;

export const isLocalModule = (source: ModuleSource): source is LocalModuleSource => 'path' in source;

export const isGitModule = (source: ModuleSource): source is GitModuleSource => 'git' in source;

/** Two sources are the same pin request when every field matches. */
export const sameSource = (left: RouterSource | ModuleSource, right: RouterSource | ModuleSource): boolean =>
  JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());

export const describeRouterSource = (source: RouterSource): string => {
  if ('release' in source) {
    return `release ${source.release}`;
  }
  if ('rc' in source) {
    return `release candidate ${source.rc}`;
  }
  return `commit ${source.commit}`;
};

export const describeModuleSource = (source: ModuleSource): string => {
  if (isLocalModule(source)) {
    return source.path;
  }
  if (isGitModule(source)) {
    return source.package ? `${source.git} (${source.package})` : source.git;
  }
  return source.go;
};

/** Reads a router candidate as typed on the command line: a release, a release candidate or a commit. */
export const parseRouterCandidate = (candidate: string): Result<RouterSource> => {
  const version = semver.valid(candidate) !== null;
  const releaseOrCandidate = semver.prerelease(candidate) === null ? { release: candidate } : { rc: candidate };
  const source = version ? releaseOrCandidate : { commit: candidate };
  const parsed = routerSourceSchema.safeParse(source);
  if (!parsed.success) {
    return failWith({
      message: `"${candidate}" is not a router release, release candidate or commit.`,
      input: candidate,
      remediation: 'Pass a release such as 0.299.0, a release candidate such as 0.300.0-rc.1, or a commit SHA.',
    });
  }
  return { success: true, data: parsed.data };
};

/** Turns the first schema issue into `<file>: <field>: <problem>`. */
export const describeSchemaIssue = (fileName: string, error: z.ZodError): { message: string; input: string } => {
  const [issue] = error.issues;
  const field = issue.path.length > 0 ? issue.path.join('.') : fileName;
  return { message: `${fileName} is not valid: ${field} ${issue.message}.`, input: `${fileName}: ${field}` };
};

export const parseManifest = (text: string): Result<Manifest> => {
  let document: unknown;
  try {
    document = yaml.load(text);
  } catch (error) {
    return failWith({
      message: `${manifestFileName} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      input: manifestFileName,
      remediation: `Correct the YAML syntax in ${manifestFileName}.`,
    });
  }

  const parsed = manifestSchema.safeParse(document);
  if (!parsed.success) {
    return failWith({
      ...describeSchemaIssue(manifestFileName, parsed.error),
      remediation: `Correct the field in ${manifestFileName}. Run \`wgc forge init\` in an empty directory to see a valid file.`,
    });
  }
  return { success: true, data: parsed.data };
};

export const readManifest = async (workspace: string): Promise<Result<Manifest>> => {
  let text: string;
  try {
    text = await readFile(path.join(workspace, manifestFileName), 'utf8');
  } catch {
    return failWith({
      message: `No ${manifestFileName} in ${workspace}.`,
      input: path.join(workspace, manifestFileName),
      remediation: 'Run `wgc forge init` to create a Forge workspace here, or pass --dir <workspace>.',
    });
  }
  return parseManifest(text);
};

export const renderManifest = (manifest: Manifest): string => {
  const { version, router, binary, test, modules, check } = manifest;
  return yaml.dump(
    {
      version,
      router,
      binary,
      ...(test === undefined ? {} : { test }),
      modules,
      ...(check === undefined ? {} : { check }),
    },
    { lineWidth: -1 },
  );
};

export const writeManifest = async (workspace: string, manifest: Manifest): Promise<void> => {
  await writeFile(path.join(workspace, manifestFileName), renderManifest(manifest));
};
