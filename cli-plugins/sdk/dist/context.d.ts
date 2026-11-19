import { CallerKind } from './caller.js';
import { Credentials } from './credentials.js';
import { Writable } from './output.js';
import { Endpoints, PluginContext } from './plugin.js';
import { Prompts } from './prompts.js';
export declare const createPluginContext: ({ cliVersion, caller, endpoints, credentials, prompts, stdout, stderr, }: {
    cliVersion: string;
    caller: CallerKind;
    endpoints: Endpoints;
    credentials: Credentials;
    prompts?: Prompts;
    stdout?: Writable;
    stderr?: Writable;
}) => PluginContext;
