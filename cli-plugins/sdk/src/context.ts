import { CallerKind, OutputOverride, prefersJson } from './caller.js';
import { Credentials } from './credentials.js';
import { createOutput, Writable } from './output.js';
import { Endpoints, PluginContext } from './plugin.js';
import { createPrompts, Prompts } from './prompts.js';

const wantsJson = (flag: boolean | undefined, override: OutputOverride | undefined, caller: CallerKind): boolean => {
  if (flag === true) {
    return true;
  }
  if (override !== undefined) {
    return override === 'json';
  }
  return prefersJson(caller);
};

export const createPluginContext = ({
  cliVersion,
  caller,
  endpoints,
  credentials,
  outputOverride,
  prompts = createPrompts({ canPrompt: caller === 'human' }),
  stdout,
  stderr,
}: {
  cliVersion: string;
  caller: CallerKind;
  endpoints: Endpoints;
  credentials: Credentials;
  outputOverride?: OutputOverride;
  prompts?: Prompts;
  stdout?: Writable;
  stderr?: Writable;
}): PluginContext => ({
  cliVersion,
  caller,
  endpoints,
  credentials,
  prompts,
  output: ({ json }) => createOutput({ json: wantsJson(json, outputOverride, caller), stdout, stderr }),
});
