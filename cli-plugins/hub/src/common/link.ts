import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { failWith, ok } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { locateConfig } from '@wundergraph/wgc-plugin-sdk/config';

export const linkFilePath = path.join('.wgc', 'link.json');

const gitignoreEntry = '.wgc/';

/** Which remote sandbox a checkout talks to. Local to the checkout, so it is gitignored. */
const linkShape = z.object({ sandbox: z.string() });

export type SandboxLink = z.infer<typeof linkShape>;

/** `--config` wins; otherwise the nearest wundergraph.yaml in the cwd or a parent directory. */
export const locateProjectConfig = (cwd: string, configFlag: string | undefined): string | undefined =>
  configFlag === undefined ? locateConfig(cwd) : path.resolve(cwd, configFlag);

/** The directory that holds `.wgc/link.json`: next to wundergraph.yaml, or the cwd without one. */
export const projectDirectory = (cwd: string, configFlag: string | undefined): string => {
  const config = locateProjectConfig(cwd, configFlag);
  return config === undefined ? cwd : path.dirname(config);
};

export const readLink = async (directory: string): Promise<Result<SandboxLink | undefined>> => {
  const file = path.join(directory, linkFilePath);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return ok(undefined);
  }

  let document: z.core.util.JSONType | undefined;
  try {
    document = z.json().parse(JSON.parse(text));
  } catch {
    document = undefined;
  }

  const parsed = linkShape.safeParse(document);
  if (!parsed.success) {
    return failWith({
      kind: 'usage',
      message: `${file} is not a sandbox link.`,
      remediation: 'Run `wgc hub link <sandbox>` to rewrite it.',
      input: file,
    });
  }
  return ok(parsed.data);
};

const addToGitignore = async (directory: string): Promise<boolean> => {
  const file = path.join(directory, '.gitignore');
  const existing = existsSync(file) ? await readFile(file, 'utf8') : '';
  const lines = new Set(existing.split('\n').map((line) => line.trim()));
  if (lines.has(gitignoreEntry) || lines.has('.wgc')) {
    return false;
  }

  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
  await writeFile(file, `${existing}${separator}${gitignoreEntry}\n`);
  return true;
};

export interface LinkWrite {
  /** False when the directory was already linked to this sandbox. */
  changed: boolean;
  /** True when this write added `.wgc/` to `.gitignore`. */
  gitignoreUpdated: boolean;
}

export const writeLink = async (directory: string, link: SandboxLink): Promise<LinkWrite> => {
  const existing = await readLink(directory);
  const unchanged = existing.success && existing.data !== undefined && existing.data.sandbox === link.sandbox;

  if (!unchanged) {
    await mkdir(path.join(directory, '.wgc'), { recursive: true });
    await writeFile(path.join(directory, linkFilePath), `${JSON.stringify(link, null, 2)}\n`);
  }

  const gitignoreUpdated = await addToGitignore(directory);
  return { changed: !unchanged, gitignoreUpdated };
};

export const removeLink = async (directory: string): Promise<boolean> => {
  const file = path.join(directory, linkFilePath);
  if (!existsSync(file)) {
    return false;
  }
  await rm(file);
  return true;
};

export const describeLinkWrite = (sandbox: string, write: LinkWrite): string => {
  if (!write.changed) {
    return `This directory is linked to ${sandbox} (${linkFilePath})`;
  }
  const gitignore = write.gitignoreUpdated ? ', added to .gitignore' : '';
  return `Linked this directory to ${sandbox} (${linkFilePath}${gitignore})`;
};

/** A sandbox to act on, `<schema>/<sandbox>`, and where it was named. */
export interface SandboxSelection {
  source: 'flag' | 'env' | 'link';
  sandbox: string;
}

/** `--sandbox` > WGC_SANDBOX > `.wgc/link.json`; with none of them, the caller must pass one. */
export const selectSandbox = async ({
  flag,
  env,
  directory,
}: {
  flag: string | undefined;
  env: NodeJS.ProcessEnv;
  directory: string;
}): Promise<Result<SandboxSelection>> => {
  if (flag) {
    return ok({ source: 'flag', sandbox: flag });
  }
  if (env.WGC_SANDBOX) {
    return ok({ source: 'env', sandbox: env.WGC_SANDBOX });
  }

  const link = await readLink(directory);
  if (!link.success) {
    return link;
  }
  if (link.data) {
    return ok({ source: 'link', sandbox: link.data.sandbox });
  }

  return failWith({
    kind: 'usage',
    message: `No sandbox is linked to ${directory}.`,
    remediation:
      'Pass --sandbox <schema>/<sandbox>, set WGC_SANDBOX, or link this directory with `wgc hub link <sandbox>`.',
    next: ['wgc hub link <sandbox>'],
  });
};
