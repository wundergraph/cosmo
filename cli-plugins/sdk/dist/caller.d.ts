/**
 * Who runs the command. Only a human at a terminal gets prompts and readable output by default;
 * agents, CI and other non-interactive callers get prompt-free JSON.
 */
export type CallerKind = 'human' | 'agent' | 'ci' | 'script';
export declare const detectCaller: (env: NodeJS.ProcessEnv, interactive: boolean) => CallerKind;
export declare const prefersJson: (caller: CallerKind) => boolean;
