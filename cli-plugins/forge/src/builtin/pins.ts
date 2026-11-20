import type { Output, Result } from '@wundergraph/wgc-plugin-sdk';
import type { Lock, LockedModule, LockedRouter } from './lock.js';
import { describeModuleSource, describeRouterSource, isGitModule, isLocalModule, sameSource } from './manifest.js';
import type { Manifest, ModuleSource } from './manifest.js';
import { resolveModule, resolveRouter } from './resolve.js';
import type { System } from './system.js';

/**
 * Works out the pins for a manifest. Pins already in `previous` for an unchanged source are kept, so only an
 * explicit re-add moves a branch or a versionless package forward.
 */
export const resolvePins = async ({
  manifest,
  previous,
  system,
  output,
}: {
  manifest: Manifest;
  previous: Lock | undefined;
  system: System;
  output: Output;
}): Promise<Result<Lock>> => {
  const routerSubject = `router ${describeRouterSource(manifest.router)}`;
  let router: LockedRouter;
  if (previous && sameSource(previous.router.source, manifest.router)) {
    router = previous.router;
    output.progress({ step: 'resolve-router', subject: routerSubject, message: `Pinned at ${router.version}` });
  } else {
    output.progress({ step: 'resolve-router', subject: routerSubject, message: 'Resolving the commit and Go version' });
    const resolved = await resolveRouter(system, manifest.router);
    if (!resolved.success) {
      return resolved;
    }
    router = resolved.data;
    output.progress({ step: 'resolve-router', subject: routerSubject, message: `Resolved to ${router.version}` });
  }

  const modules: LockedModule[] = [];
  for (const source of manifest.modules) {
    const subject = describeModuleSource(source);
    if (isLocalModule(source)) {
      output.progress({ step: 'resolve-module', subject, message: 'Local module, built from disk and not pinned' });
      continue;
    }

    const pinned = previous?.modules.find((module) => sameSource(module.source, source));
    if (pinned) {
      modules.push(pinned);
      output.progress({ step: 'resolve-module', subject, message: `Pinned at ${pinned.version}` });
      continue;
    }

    output.progress({ step: 'resolve-module', subject, message: 'Resolving the version' });
    const resolved = await resolveModule(system, source);
    if (!resolved.success) {
      return resolved;
    }
    modules.push(resolved.data);
    output.progress({ step: 'resolve-module', subject, message: `Resolved to ${resolved.data.version}` });
  }

  return { success: true, data: { version: 1, router, modules } };
};

/** True when `lock` pins exactly the router and remote modules `manifest` asks for. */
export const lockMatches = (manifest: Manifest, lock: Lock | undefined): lock is Lock => {
  if (lock === undefined || !sameSource(lock.router.source, manifest.router)) {
    return false;
  }

  const remoteModules = manifest.modules.filter((source) => !isLocalModule(source));
  if (remoteModules.length !== lock.modules.length) {
    return false;
  }

  return remoteModules.every((source) => lock.modules.some((module) => sameSource(module.source, source)));
};

/** Two entries register the same module when they name the same directory, Go package or Git package. */
export const sameModule = (left: ModuleSource, right: ModuleSource): boolean => {
  if (isLocalModule(left) || isLocalModule(right)) {
    return isLocalModule(left) && isLocalModule(right) && left.path === right.path;
  }

  if (isGitModule(left) || isGitModule(right)) {
    return isGitModule(left) && isGitModule(right) && left.git === right.git && left.package === right.package;
  }

  return left.go === right.go;
};

export interface PinChange {
  module: string;
  from?: string;
  to?: string;
}

const pinLabel = (module: LockedModule): string =>
  module.commit === undefined ? module.version : `${module.version} (${module.commit.slice(0, 12)})`;

/** The module pins that differ between two locks, matched by module rather than by exact source. */
export const diffPins = (previous: LockedModule[], next: LockedModule[]): PinChange[] => {
  const changes: PinChange[] = [];

  for (const module of next) {
    const before = previous.find((candidate) => sameModule(candidate.source, module.source));
    if (before === undefined) {
      changes.push({ module: describeModuleSource(module.source), to: pinLabel(module) });
      continue;
    }

    if (JSON.stringify(before) !== JSON.stringify(module)) {
      changes.push({ module: describeModuleSource(module.source), from: pinLabel(before), to: pinLabel(module) });
    }
  }

  for (const module of previous) {
    if (!next.some((candidate) => sameModule(candidate.source, module.source))) {
      changes.push({ module: describeModuleSource(module.source), from: pinLabel(module) });
    }
  }

  return changes;
};

export const describePinChange = (change: PinChange): string => {
  if (change.from === undefined) {
    return `+ ${change.module} ${change.to}`;
  }
  if (change.to === undefined) {
    return `- ${change.module} ${change.from}`;
  }
  return `~ ${change.module} ${change.from} -> ${change.to}`;
};
