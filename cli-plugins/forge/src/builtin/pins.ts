import type { Output, Result } from '@wundergraph/wgc-plugin-sdk';
import type { Lock, LockedModule, LockedRouter } from './lock.js';
import { describeModuleSource, describeRouterSource, isLocalModule, sameSource } from './manifest.js';
import type { Manifest } from './manifest.js';
import { resolveModule, resolveRouter } from './resolve.js';
import type { System } from './system.js';

/**
 * Works out the pins for a manifest. Pins already in `previous` for an unchanged source are kept unless
 * `refresh` is set, so a build is reproducible and only `wgc forge lock` moves a branch or `latest` forward.
 */
export const resolvePins = async ({
  manifest,
  previous,
  refresh,
  system,
  output,
}: {
  manifest: Manifest;
  previous: Lock | undefined;
  refresh: boolean;
  system: System;
  output: Output;
}): Promise<Result<Lock>> => {
  const routerSubject = `router ${describeRouterSource(manifest.router)}`;
  let router: LockedRouter;
  if (!refresh && previous && sameSource(previous.router.source, manifest.router)) {
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

    const pinned = refresh ? undefined : previous?.modules.find((module) => sameSource(module.source, source));
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
