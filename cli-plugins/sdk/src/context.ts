import { CallerKind, prefersJson } from './caller.js';
import { Credentials } from './credentials.js';
import { createOutput, Writable } from './output.js';
import { Endpoints, PluginContext } from './plugin.js';
import { createPrompts, Prompts } from './prompts.js';

export const createPluginContext = ({
  cliVersion,
  caller,
  endpoints,
  credentials,
  prompts = createPrompts({ canPrompt: caller === 'human' }),
  stdout,
  stderr,
}: {
  cliVersion: string;
  caller: CallerKind;
  endpoints: Endpoints;
  credentials: Credentials;
  prompts?: Prompts;
  stdout?: Writable;
  stderr?: Writable;
}): PluginContext => ({
  cliVersion,
  caller,
  endpoints,
  credentials,
  prompts,
  output: ({ json }) => createOutput({ json: json === true || prefersJson(caller), stdout, stderr }),
});
