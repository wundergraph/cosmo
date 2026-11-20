import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const channels = ['stable', 'nightly'] as const;

export type Channel = (typeof channels)[number];

const channelSchema = z.enum(channels);

const settingsSchema = z.object({ channel: channelSchema.default('stable') });

/** The user's release channel for future CLI upgrades. Stable until they pick another. */
export const readChannel = async (settingsFile: string): Promise<Channel> => {
  try {
    return settingsSchema.parse(JSON.parse(await readFile(settingsFile, 'utf8'))).channel;
  } catch {
    return 'stable';
  }
};

export const writeChannel = async (settingsFile: string, channel: Channel): Promise<void> => {
  await mkdir(path.dirname(settingsFile), { recursive: true });
  await writeFile(settingsFile, `${JSON.stringify({ channel }, null, 2)}\n`);
};

export const isChannel = (value: string): value is Channel => channelSchema.safeParse(value).success;
