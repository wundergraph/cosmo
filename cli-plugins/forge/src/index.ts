import path from 'node:path';
import { definePlugin } from '@wundergraph/wgc-plugin-sdk';
import type { PluginContext, WgcPlugin } from '@wundergraph/wgc-plugin-sdk';
import { createBinaryEngine } from './binary-engine.js';
import { createBuiltinEngine } from './builtin/engine.js';
import { chooseEngine } from './engine.js';
import type { ForgeEngine } from './engine.js';
import { createSystem } from './builtin/system.js';

const engineFor = (env: NodeJS.ProcessEnv, argv: () => string[], context: PluginContext): ForgeEngine => {
  const choice = chooseEngine(env);
  if (choice.kind === 'binary') {
    return createBinaryEngine({ binary: choice.binary, argv });
  }

  return createBuiltinEngine({
    system: createSystem(),
    cwd: () => process.cwd(),
    settingsFile: path.join(context.homeDir, 'forge.json'),
  });
};

export const createForgePlugin = ({
  env = process.env,
  argv = () => process.argv,
}: { env?: NodeJS.ProcessEnv; argv?: () => string[] } = {}): WgcPlugin =>
  definePlugin({
    name: 'forge',
    description: 'Build and upgrade a Cosmo Router with custom modules',
    register(command, context) {
      engineFor(env, argv, context).register(command, context);
    },
  });

export default createForgePlugin();
