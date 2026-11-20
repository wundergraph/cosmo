import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'pathe';
import { z } from 'zod';
import { errorMessage, failWith, ok } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { cacheDir, config } from './config.js';
import { deployment } from './deployment.js';

const httpUrl = z.url({ protocol: /^https?$/ });

/** What every Hub serves, without auth, at `GET /.well-known/hub.json`. */
const hubJson = z.object({
  instance: z.string().min(1),
  apiUrl: httpUrl,
  mcpUrl: httpUrl,
  appUrl: httpUrl,
  studioUrl: httpUrl,
  cosmoApiUrl: httpUrl,
  cdnUrl: httpUrl,
});

const knownInstance = hubJson.extend({ hubOrigin: httpUrl });

type KnownInstance = z.infer<typeof knownInstance>;

/** Instance name to the URLs its Hub announced, cached across runs. */
const instanceCache = z.record(z.string(), knownInstance);

type InstanceCache = z.infer<typeof instanceCache>;

/** The instance a Hub token names: `wg_<instance>_<kind>_<rest>`. Other tokens name none. */
export const tokenInstance = (token: string): string | undefined => /^wg_([^_]+)_[^_]+_./.exec(token)?.[1];

const originsOf = (instance: KnownInstance): string[] =>
  [
    instance.hubOrigin,
    instance.apiUrl,
    instance.mcpUrl,
    instance.appUrl,
    instance.studioUrl,
    instance.cosmoApiUrl,
    instance.cdnUrl,
  ].map((url) => new URL(url).origin);

export interface InstanceRegistry {
  /** Fails, without sending anything, when `token` names a Hub instance that `target` is not part of. */
  authorize(token: string, target: URL): Promise<Result<void>>;
}

export const createInstanceRegistry = ({
  hubUrls,
  cacheFile,
  fetchImpl = fetch,
}: {
  hubUrls: string[];
  cacheFile: string;
  fetchImpl?: typeof fetch;
}): InstanceRegistry => {
  const readCache = async (): Promise<InstanceCache> => {
    try {
      const parsed = instanceCache.safeParse(JSON.parse(await readFile(cacheFile, 'utf8')));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  };

  const readHubJson = async (hubOrigin: string): Promise<Result<KnownInstance>> => {
    const url = new URL('/.well-known/hub.json', hubOrigin);
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        return failWith({ message: `${url} answered HTTP ${response.status}.` });
      }
      const parsed = hubJson.safeParse(await response.json());
      if (!parsed.success) {
        return failWith({ message: `${url} is not a valid hub.json: ${z.prettifyError(parsed.error)}` });
      }
      return ok({ ...parsed.data, hubOrigin });
    } catch (error) {
      return failWith({ message: `Could not read ${url}: ${(error as Error).message}` });
    }
  };

  /** Reads hub.json from each known Hub not cached yet, unless the cache already has `instance`. */
  const resolve = async (instance: string): Promise<{ known: InstanceCache; unreachable: string[] }> => {
    const known = await readCache();
    if (known[instance]) {
      return { known, unreachable: [] };
    }

    const cachedOrigins = new Set(Object.values(known).map((entry) => entry.hubOrigin));
    const pending = [...new Set(hubUrls.map((url) => new URL(url).origin))].filter(
      (origin) => !cachedOrigins.has(origin),
    );
    const unreachable: string[] = [];
    for (const origin of pending) {
      const read = await readHubJson(origin);
      if (read.success) {
        known[read.data.instance] = read.data;
      } else {
        unreachable.push(errorMessage(read));
      }
    }

    if (unreachable.length < pending.length) {
      await mkdir(dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, JSON.stringify(known, null, 2));
    }
    return { known, unreachable };
  };

  return {
    async authorize(token, target) {
      const instance = tokenInstance(token);
      if (instance === undefined) {
        return ok(undefined);
      }

      const { known, unreachable } = await resolve(instance);
      const names = Object.keys(known).sort().join(', ') || 'none';
      const own = known[instance];
      if (!own) {
        return failWith({
          kind: 'usage',
          message: `The token is for Hub instance "${instance}", which no known Hub serves. Known instances: ${names}.`,
          remediation: [...unreachable, `Set HUB_URL to the ${instance} Hub.`].join('\n'),
        });
      }

      if (originsOf(own).includes(target.origin)) {
        return ok(undefined);
      }
      const owner = Object.values(known).find((entry) => originsOf(entry).includes(target.origin));
      return failWith({
        kind: 'usage',
        message: `The token is for Hub instance "${instance}", but ${target.origin} ${
          owner ? `belongs to instance "${owner.instance}"` : 'belongs to no known instance'
        }. Known instances: ${names}.`,
        remediation: `Use a wg_${owner?.instance ?? '<instance>'}_ token, or point wgc at the ${instance} Hub's URLs.`,
      });
    },
  };
};

/**
 * wgc knows the Hub baked into this build and the one HUB_URL names; each Hub's hub.json says which
 * instance it is. A token for any other instance is refused until HUB_URL points at its Hub.
 */
export const instanceRegistry = createInstanceRegistry({
  hubUrls: [deployment.hubUrl, config.hubURL],
  cacheFile: join(cacheDir, 'hub-instances.json'),
});
