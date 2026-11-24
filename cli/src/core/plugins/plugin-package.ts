import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'pathe';
import { z } from 'zod';
import { failure, ok } from '@wundergraph/wgc-plugin-sdk';
import type { Result, WgcPlugin } from '@wundergraph/wgc-plugin-sdk';

/** Plugins wgc knows by name, so `wgc plugins install hub` works without the package name. */
export const knownPlugins: Readonly<Record<string, string>> = {
  hub: '@wundergraph/wgc-plugin-hub',
  forge: '@wundergraph/wgc-plugin-forge',
};

export const pluginKeyword = 'wgc-plugin';

const sdkPackageName = '@wundergraph/wgc-plugin-sdk';

const namedPluginPackage = /^(?:@wundergraph\/)?wgc-plugin-([\da-z][\da-z-]*)$/;

/** The entry a package's `exports` names for `import`, when it uses one of the common shapes. */
const exportTarget = z.union([
  z.string(),
  z
    .object({ import: z.string().optional(), default: z.string().optional() })
    .transform((target) => target.import ?? target.default),
]);

const packageExports = z.union([z.object({ '.': exportTarget }).transform((exports) => exports['.']), exportTarget]);

const packageJson = z.object({
  name: z.string().min(1),
  version: z.string().default('0.0.0'),
  main: z.string().optional(),
  exports: z.json().optional(),
  keywords: z.array(z.string()).default([]),
});

export type PackageJson = z.infer<typeof packageJson>;

const pluginShape = z
  .object({
    name: z.string().regex(/^[a-z][\da-z-]*$/, 'name must be a lowercase command name'),
    description: z.string(),
    register: z
      .custom<WgcPlugin['register']>((value) => typeof value === 'function', 'register must be a function')
      .optional(),
    hooks: z.custom<WgcPlugin['hooks']>((value) => typeof value === 'function', 'hooks must be a function').optional(),
  })
  .refine((plugin) => plugin.register !== undefined || plugin.hooks !== undefined, {
    message: 'a plugin must register commands, hooks or both',
  });

const pluginModule = z.object({ default: pluginShape });

export const readPackageJson = (directory: string): Result<PackageJson> => {
  const path = join(directory, 'package.json');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return failure(`No package.json at ${path}.`, error as Error);
  }

  let json: z.core.util.JSONType;
  try {
    json = z.json().parse(JSON.parse(text));
  } catch (error) {
    return failure(`${path} is not valid JSON.`, error as Error);
  }

  const parsed = packageJson.safeParse(json);
  if (!parsed.success) {
    return failure(`${path} is not a valid package.json: ${z.prettifyError(parsed.error)}`);
  }
  return ok(parsed.data);
};

export const isPluginPackage = (pkg: PackageJson): boolean => {
  if (pkg.name === sdkPackageName) {
    return false;
  }
  return (
    Object.values(knownPlugins).includes(pkg.name) ||
    namedPluginPackage.test(pkg.name) ||
    pkg.keywords.includes(pluginKeyword)
  );
};

export const packageEntry = (directory: string, pkg: PackageJson): string => {
  const exported = packageExports.safeParse(pkg.exports);
  const exportedPath = exported.success ? exported.data : undefined;
  return join(directory, exportedPath ?? pkg.main ?? 'index.js');
};

/** Imports a plugin module and checks its default export is a `WgcPlugin`, named `expectedName` when given. */
export const loadPlugin = async (entryPath: string, expectedName?: string): Promise<Result<WgcPlugin>> => {
  let loaded: object;
  try {
    loaded = await import(pathToFileURL(entryPath).href);
  } catch (error) {
    return failure(`Could not load the plugin at ${entryPath}: ${(error as Error).message}`);
  }

  const parsed = pluginModule.safeParse(loaded);
  if (!parsed.success) {
    return failure(
      `${entryPath} is not a wgc plugin. Its default export must be a WgcPlugin: ${z.prettifyError(parsed.error)}`,
    );
  }
  if (expectedName !== undefined && parsed.data.default.name !== expectedName) {
    return failure(
      `The plugin at ${entryPath} is named ${parsed.data.default.name}, but wgc expected ${expectedName}.`,
    );
  }
  return ok(parsed.data.default);
};
