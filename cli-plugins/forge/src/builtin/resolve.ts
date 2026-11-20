import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import semver from 'semver';
import { z } from 'zod';
import { fail, lastLines } from './failure.js';
import type { LockedModule, LockedRouter } from './lock.js';
import { describeRouterSource, isGitModule } from './manifest.js';
import type { GitModuleSource, GoModuleSource, RemoteModuleSource, RouterSource } from './manifest.js';
import type { System } from './system.js';

export const routerModule = 'github.com/wundergraph/cosmo/router';
export const routerRepository = 'https://github.com/wundergraph/cosmo';

/** Cosmo tags router releases as `router@<version>`, which Go cannot resolve as a module version. */
const routerTag = (version: string): string => `refs/tags/router@${version}`;

const goModuleInfoSchema = z.object({
  Path: z.string(),
  Version: z.string(),
  GoMod: z.string().optional(),
  Origin: z.object({ Hash: z.string().optional() }).optional(),
});

type GoModuleInfo = z.infer<typeof goModuleInfoSchema>;

const fullCommitPattern = /^[\da-f]{40}$/;
const commandNotFound = 127;

const missingTool = <T>(tool: 'go' | 'git'): Result<T> =>
  fail({
    message: `Forge needs \`${tool}\` to resolve and build the router, but it is not installed.`,
    input: tool,
    fix:
      tool === 'go'
        ? 'Install Go from https://go.dev/dl and run the command again.'
        : 'Install git and run the command again.',
  });

/** Asks Go which module version a query such as `<module>@<commit>` selects. */
const goListModule = async (system: System, query: string): Promise<Result<GoModuleInfo>> => {
  const outcome = await system.run({
    file: 'go',
    args: ['list', '-m', '-json', query],
    cwd: tmpdir(),
    env: { GOWORK: 'off', GOFLAGS: '-mod=mod' },
  });
  if (outcome.exitCode === commandNotFound) {
    return missingTool('go');
  }
  if (outcome.exitCode !== 0) {
    return fail({ message: `Go could not resolve ${query}:\n${lastLines(outcome.stderr, 5)}`, input: query });
  }

  let document: unknown;
  try {
    document = JSON.parse(outcome.stdout);
  } catch {
    document = undefined;
  }
  const parsed = goModuleInfoSchema.safeParse(document);
  if (!parsed.success) {
    return fail({ message: `Go returned an unexpected answer for ${query}.`, input: query });
  }
  return { success: true, data: parsed.data };
};

/** Lists the remote refs matching `patterns` as ref name to commit. */
const listRemoteRefs = async (
  system: System,
  url: string,
  patterns: string[],
): Promise<Result<Map<string, string>>> => {
  const outcome = await system.run({ file: 'git', args: ['ls-remote', url, ...patterns] });
  if (outcome.exitCode === commandNotFound) {
    return missingTool('git');
  }
  if (outcome.exitCode !== 0) {
    return fail({
      message: `git could not read ${url}:\n${lastLines(outcome.stderr, 5)}`,
      input: url,
      fix: 'Check the URL, your network connection and that you can read the repository.',
    });
  }

  const refs = new Map<string, string>();
  for (const line of outcome.stdout.split('\n')) {
    const [commit, ref] = line.trim().split(/\s+/);
    if (commit && ref) {
      refs.set(ref, commit);
    }
  }
  return { success: true, data: refs };
};

/** The newest router release, used when `init` is not told which one to pin. */
export const latestRouterRelease = async (system: System): Promise<Result<string>> => {
  const refs = await listRemoteRefs(system, routerRepository, [routerTag('*')]);
  if (!refs.success) {
    return refs;
  }

  const releases = [...refs.data.keys()]
    .map((ref) => ref.replace('refs/tags/router@', ''))
    .filter((version) => semver.valid(version) !== null && semver.prerelease(version) === null);
  const [latest] = semver.rsort(releases);
  if (latest === undefined) {
    return fail({
      message: `No router release tags were found in ${routerRepository}.`,
      input: routerRepository,
      fix: 'Pass the release yourself, for example `wgc forge init --release 0.299.0`.',
    });
  }
  return { success: true, data: latest };
};

const resolveRouterCommit = async (system: System, source: RouterSource): Promise<Result<string>> => {
  if ('commit' in source) {
    return { success: true, data: source.commit };
  }

  const version = 'release' in source ? source.release : source.rc;
  const tag = routerTag(version);
  // An annotated tag lists the tag object under its name and the commit under `<name>^{}`.
  const refs = await listRemoteRefs(system, routerRepository, [tag, `${tag}^{}`]);
  if (!refs.success) {
    return refs;
  }

  const commit = refs.data.get(`${tag}^{}`) ?? refs.data.get(tag);
  if (commit === undefined) {
    return fail({
      message: `Router ${describeRouterSource(source)} does not exist: ${routerRepository} has no tag router@${version}.`,
      input: `router@${version}`,
      fix: `List the router versions with \`git ls-remote --tags ${routerRepository} 'refs/tags/router@*'\` and pick one of them.`,
    });
  }
  return { success: true, data: commit };
};

const readGoVersion = async (goModPath: string | undefined): Promise<string | undefined> => {
  if (goModPath === undefined) {
    return undefined;
  }
  try {
    return /^go (\S+)$/m.exec(await readFile(goModPath, 'utf8'))?.[1];
  } catch {
    return undefined;
  }
};

/** Resolves a release, release candidate or commit to the commit and Go module version to build. */
export const resolveRouter = async (system: System, source: RouterSource): Promise<Result<LockedRouter>> => {
  const commit = await resolveRouterCommit(system, source);
  if (!commit.success) {
    return commit;
  }

  const info = await goListModule(system, `${routerModule}@${commit.data}`);
  if (!info.success) {
    return fail({
      message: `Go could not resolve the router at ${describeRouterSource(source)} (commit ${commit.data}).\n${info.errors[0].message}`,
      input: `${routerModule}@${commit.data}`,
      fix: 'Check that the commit exists in the Cosmo repository and that the Go module proxy is reachable.',
    });
  }

  const fullCommit = info.data.Origin?.Hash ?? commit.data;
  const goVersion = await readGoVersion(info.data.GoMod);
  if (!fullCommitPattern.test(fullCommit) || goVersion === undefined) {
    return fail({
      message: `Go did not report the full commit and Go version of ${routerModule}@${commit.data}.`,
      input: `${routerModule}@${commit.data}`,
      fix: 'Pass the full 40 character commit SHA.',
    });
  }

  return { success: true, data: { source, commit: fullCommit, version: info.data.Version, goVersion } };
};

/** `https://github.com/acme/modules.git` and `git@github.com:acme/modules.git` both name `github.com/acme/modules`. */
export const gitRepositoryPath = (url: string): Result<string> => {
  const match = /^(?:[+a-z]+:\/\/(?:[^/@]+@)?|[^/@]+@)([^/:]+)[/:](.+?)(?:\.git)?\/?$/.exec(url);
  if (!match) {
    return fail({
      message: `"${url}" is not a Git URL Forge can read.`,
      input: url,
      fix: 'Use an HTTPS or SSH URL such as https://github.com/acme/router-modules.git.',
    });
  }
  return { success: true, data: `${match[1]}/${match[2]}` };
};

/**
 * Finds the Go module that contains `packagePath` by asking Go about the path and then each parent,
 * because a package can sit below the root of its module.
 */
const findContainingModule = async (
  system: System,
  packagePath: string,
  query: string,
  shortestPath: string,
): Promise<Result<GoModuleInfo>> => {
  let candidate = packagePath;
  let lastFailure: Result<GoModuleInfo> | undefined;

  while (candidate.length >= shortestPath.length) {
    const info = await goListModule(system, `${candidate}@${query}`);
    if (info.success && info.data.Path === candidate) {
      return info;
    }
    if (!info.success) {
      lastFailure = info;
    }
    if (!candidate.includes('/')) {
      break;
    }
    candidate = candidate.slice(0, candidate.lastIndexOf('/'));
  }

  return lastFailure ?? fail({ message: `No Go module contains ${packagePath}.`, input: packagePath });
};

const resolveGoModule = async (system: System, source: GoModuleSource): Promise<Result<LockedModule>> => {
  const [host, owner] = source.go.split('/');
  const info = await findContainingModule(system, source.go, source.version ?? 'latest', `${host}/${owner ?? ''}`);
  if (!info.success) {
    return fail({
      message: `Go package ${source.go} could not be resolved${source.version ? ` at ${source.version}` : ''}.\n${info.errors[0].message}`,
      input: source.version ? `${source.go}@${source.version}` : source.go,
      fix: 'Check the package path and version, and that `go` can download it (GOPRIVATE for private modules).',
    });
  }

  const commit = info.data.Origin?.Hash;
  return {
    success: true,
    data: {
      source,
      module: info.data.Path,
      package: source.go,
      version: info.data.Version,
      ...(commit && fullCommitPattern.test(commit) ? { commit } : {}),
    },
  };
};

const resolveGitModule = async (system: System, source: GitModuleSource): Promise<Result<LockedModule>> => {
  const repository = gitRepositoryPath(source.git);
  if (!repository.success) {
    return repository;
  }

  const ref = source.ref ?? 'HEAD';
  let commit = ref;
  if (!fullCommitPattern.test(ref)) {
    const refs = await listRemoteRefs(system, source.git, [ref, `${ref}^{}`]);
    if (!refs.success) {
      return refs;
    }
    const resolved = refs.data.get(`refs/tags/${ref}^{}`) ?? [...refs.data.values()][0];
    if (resolved === undefined) {
      return fail({
        message: `${source.git} has no branch, tag or commit named "${ref}".`,
        input: `${source.git} ref ${ref}`,
        fix: `List the refs with \`git ls-remote ${source.git}\` and pass one with --ref.`,
      });
    }
    commit = resolved;
  }

  const packagePath = source.package ? `${repository.data}/${source.package}` : repository.data;
  const info = await findContainingModule(system, packagePath, commit, repository.data);
  if (!info.success) {
    return fail({
      message: `No Go module was found for ${packagePath} at commit ${commit}.\n${info.errors[0].message}`,
      input: source.package ? `${source.git} package ${source.package}` : source.git,
      fix: 'Check that the repository has a go.mod at its root or in the --package directory.',
    });
  }

  return {
    success: true,
    data: { source, module: info.data.Path, package: packagePath, version: info.data.Version, commit },
  };
};

/** Pins a remote module to the exact version, and commit where Go reports one, that the build will use. */
export const resolveModule = (system: System, source: RemoteModuleSource): Promise<Result<LockedModule>> =>
  isGitModule(source) ? resolveGitModule(system, source) : resolveGoModule(system, source);
