import type { Command } from 'commander';
import { CallerKind } from './caller.js';
import { Credentials } from './credentials.js';
import { Output } from './output.js';
import { Prompts } from './prompts.js';
export interface Endpoints {
    cosmoApiUrl: string;
    cosmoWebUrl: string;
    hubUrl: string;
}
/** What wgc hands a plugin when it registers its commands. */
export interface PluginContext {
    cliVersion: string;
    caller: CallerKind;
    endpoints: Endpoints;
    credentials: Credentials;
    prompts: Prompts;
    /** The output for one command run. `--json` forces JSON; otherwise the caller decides. */
    output(options: {
        json?: boolean;
    }): Output;
}
export interface WgcPlugin {
    /** The top-level command the plugin owns, e.g. `hub` for `wgc hub …`. */
    name: string;
    description: string;
    /** Adds subcommands to `command`, which wgc has already named and attached to the program. */
    register(command: Command, context: PluginContext): void;
}
export declare const definePlugin: (plugin: WgcPlugin) => WgcPlugin;
