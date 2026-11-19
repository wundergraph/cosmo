import { prefersJson } from './caller.js';
import { createOutput } from './output.js';
import { createPrompts } from './prompts.js';
export const createPluginContext = ({ cliVersion, caller, endpoints, credentials, prompts = createPrompts({ canPrompt: caller === 'human' }), stdout, stderr, }) => ({
    cliVersion,
    caller,
    endpoints,
    credentials,
    prompts,
    output: ({ json }) => createOutput({ json: json === true || prefersJson(caller), stdout, stderr }),
});
//# sourceMappingURL=context.js.map