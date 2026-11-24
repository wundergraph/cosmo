import { failWith } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { routerSourceSchema } from '@wundergraph/wgc-plugin-sdk/config';
import type {
  GitModuleSource,
  LocalModuleSource,
  ModuleSource,
  RouterSource,
} from '@wundergraph/wgc-plugin-sdk/config';
import semver from 'semver';

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
