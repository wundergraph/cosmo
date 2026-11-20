import { readFileSync } from 'node:fs';

/** The version of this plugin, which is the version of the builtin Forge CLI. */
export const forgeVersion = (): string => {
  const packageJson: { version: string } = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  return packageJson.version;
};
