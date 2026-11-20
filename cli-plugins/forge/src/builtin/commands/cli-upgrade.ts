import type { Command } from 'commander';
import { channels, isChannel, readChannel, writeChannel } from '../channel.js';
import type { Channel } from '../channel.js';
import { forgeVersion } from '../version.js';
import type { ForgeDependencies } from './shared.js';

interface JsonOption {
  json?: boolean;
}

const installCommand = (command: string, channel: Channel): string =>
  channel === 'stable'
    ? `${command} plugins install forge`
    : `${command} plugins install @wundergraph/wgc-plugin-forge@nightly`;

export const registerCliUpgrade = (command: Command, dependencies: ForgeDependencies): void => {
  const { context, settingsFile } = dependencies;

  const upgrade = command
    .command('upgrade')
    .description(
      'Update the installed Forge CLI from the selected channel. This Forge comes with a wgc plugin, so it prints the update command.',
    )
    .option('--json', 'Print the result as JSON.')
    .action(async (options: JsonOption) => {
      const output = context.output({ json: options.json });
      const channel = await readChannel(settingsFile);
      const update = installCommand(context.command, channel);

      output.result(
        { installation: 'wgc-plugin', channel, version: forgeVersion(), command: update, upgraded: false },
        (data) =>
          [
            `This Forge comes with the wgc forge plugin (${data.version}, ${data.channel} channel).`,
            `Update it with: ${data.command}`,
          ].join('\n'),
      );
    });

  upgrade
    .command('channel')
    .description(
      'Select stable or nightly for future CLI upgrades. Without an argument, a person picks one and an agent or CI gets the current selection.',
    )
    .argument('[channel]', `One of ${channels.join(', ')}.`)
    .option('--json', 'Print the result as JSON.')
    .action(async (requested: string | undefined, options: JsonOption) => {
      const output = context.output({ json: options.json });
      const current = await readChannel(settingsFile);
      const interactive = context.prompts.canPrompt && options.json !== true;

      if (requested === undefined && !interactive) {
        return output.result(
          { channel: current, version: forgeVersion() },
          (data) => `Channel: ${data.channel}\nInstalled: ${data.version}`,
        );
      }

      const answer = requested ?? (await context.prompts.text(`Channel (${channels.join(', ')}):`, current));
      if (!isChannel(answer)) {
        return output.fail({
          message: `"${answer}" is not a release channel.`,
          input: answer,
          remediation: `Use one of: ${channels.join(', ')}.`,
        });
      }

      await writeChannel(settingsFile, answer);
      output.result(
        {
          channel: answer,
          previous: current,
          version: forgeVersion(),
          command: installCommand(context.command, answer),
        },
        (data) => `Channel set to ${data.channel}. Run \`wgc forge upgrade\` to install its release.`,
      );
    });
};
