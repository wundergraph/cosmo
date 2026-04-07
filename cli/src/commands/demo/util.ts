import fs from 'node:fs/promises';
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import { program } from 'commander';
import { execa, type ResultPromise } from 'execa';
import ora from 'ora';
import pc from 'picocolors';
import { z } from 'zod';
import { config, cacheDir } from '../../core/config.js';
import { getDefaultPlatforms, publishPluginPipeline, readPluginFiles } from '../../core/plugin-publish.js';
import type { BaseCommandOptions } from '../../core/types/types.js';
import { visibleLength } from '../../utils.js';
import type { UserInfo } from './types.js';

/**
 * Clears whole screen
 */
export function clearScreen() {
  process.stdout.write('\u001Bc');
}

export function resetScreen(userInfo?: UserInfo) {
  clearScreen();
  printLogo(userInfo);
}

/**
 * Fancy WG logo
 */
export function printLogo(userInfo?: UserInfo) {
  const logoLines = [
    '        ▌            ▌',
    '▌▌▌▌▌▛▌▛▌█▌▛▘▛▌▛▘▀▌▛▌▛▌',
    '▚▚▘▙▌▌▌▙▌▙▖▌ ▙▌▌ █▌▙▌▌▌',
    '             ▄▌    ▌',
  ];

  if (!userInfo) {
    console.log(`\n${logoLines.join('\n')}\n`);
    return;
  }

  const termWidth = process.stdout.columns || 80;
  const logoWidth = Math.max(...logoLines.map((l) => l.length));

  const infoLines = [
    `${pc.dim('email:')} ${pc.bold(pc.white(userInfo.userEmail))}`,
    `${pc.dim('organization:')} ${pc.bold(pc.white(userInfo.organizationName))}`,
  ];

  const infoVisibleWidths = infoLines.map((l) => visibleLength(l));
  const maxInfoWidth = Math.max(...infoVisibleWidths);

  // Minimum gap between logo and info
  const gap = 4;
  const totalNeeded = logoWidth + gap + maxInfoWidth;

  // Right-align info: compute left padding for each info line
  const availableWidth = Math.max(termWidth, totalNeeded);

  const lines = logoLines.map((line, i) => {
    if (i >= infoLines.length) {
      return line;
    }
    const infoVisibleWidth = infoVisibleWidths[i];
    const padding = availableWidth - logoWidth - infoVisibleWidth;
    return `${line.padEnd(logoWidth)}${' '.repeat(Math.max(gap, padding))}${infoLines[i]}`;
  });

  console.log(`\n${lines.join('\n')}\n`);
}

function writeEscapeSequence(s: string) {
  process.stdout.write(s);
}

/**
 * Updates the logo region at the top of the screen with userInfo
 * without clearing the rest of the screen content.
 */
export function updateScreenWithUserInfo(userInfo: UserInfo) {
  // Save cursor position, jump to top
  writeEscapeSequence('\u001B7');
  writeEscapeSequence('\u001B[H');

  // printLogo writes 6 visual lines: \n, 4 logo lines, \n
  // Clear those lines and reprint with userInfo
  // First clear the lines the logo occupies (1 blank + 4 logo + 1 blank = 6 lines)
  for (let i = 0; i < 6; i++) {
    writeEscapeSequence('\u001B[2K'); // erase line
    if (i < 5) {
      writeEscapeSequence('\u001B[B');
    } // move down
  }

  // Move back to top
  writeEscapeSequence('\u001B[H');

  // Reprint logo with userInfo (printLogo uses console.log which writes to these lines)
  printLogo(userInfo);

  // Restore cursor position
  writeEscapeSequence('\u001B8');
}

const GitHubTreeSchema = z.object({
  tree: z.array(
    z.object({
      type: z.string(),
      path: z.string(),
    }),
  ),
});

/**
 * Copies over support files (gRPC plugin data) from onboarding
 * repository and stores them in the host filesystem [cacheDir]
 * folder.
 * @returns [directory] path which contains the support data
 */
export async function prepareSupportingData() {
  const spinner = ora('Preparing supporting data…').start();

  const cosmoDir = path.join(cacheDir, 'demo');
  await fs.mkdir(cosmoDir, { recursive: true });

  const treeResponse = await fetch(
    `https://api.github.com/repos/${config.demoOnboardingRepositoryName}/git/trees/${config.demoOnboardingRepositoryBranch}?recursive=1`,
  );
  if (!treeResponse.ok) {
    spinner.fail('Failed to fetch repository tree.');
    program.error(`GitHub API error: ${treeResponse.statusText}`);
  }

  const parsed = GitHubTreeSchema.safeParse(await treeResponse.json());
  if (!parsed.success) {
    spinner.fail('Failed to parse repository tree.');
    program.error('Unexpected response format from GitHub API. The repository structure may have changed.');
  }

  const files = parsed.data.tree.filter((entry) => entry.type === 'blob' && entry.path.startsWith('plugins/'));

  const results = await Promise.all(
    files.map(async (file) => {
      const rawUrl = `https://raw.githubusercontent.com/${config.demoOnboardingRepositoryName}/${config.demoOnboardingRepositoryBranch}/${file.path}`;
      try {
        const response = await fetch(rawUrl);
        if (!response.ok) {
          return { path: file.path, error: response.statusText };
        }

        const content = Buffer.from(await response.arrayBuffer());
        const destPath = path.join(cosmoDir, file.path);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, content);

        return { path: file.path, error: null };
      } catch (err) {
        return { path: file.path, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const failed = results.filter((r) => r.error !== null);
  if (failed.length > 0) {
    spinner.fail(`Failed to fetch some files from onboarding repository or store them in ${cosmoDir}.`);
    program.error(failed.map((f) => `  ${f.path}: ${f.error}`).join('\n'));
  }

  spinner.succeed(`Support files copied to ${pc.bold(cosmoDir)}`);

  return cosmoDir;
}

async function isDockerAvailable(): Promise<boolean> {
  try {
    await execa('docker', ['version', '--format', '{{.Client.Version}}']);
    return true;
  } catch {
    return false;
  }
}

async function isBuildxAvailable(): Promise<boolean> {
  try {
    await execa('docker', ['buildx', 'version']);
    return true;
  } catch {
    return false;
  }
}

async function hasDockerContainerBuilder(): Promise<boolean> {
  try {
    const { stdout } = await execa('docker', ['buildx', 'ls']);
    for (const line of stdout.split('\n')) {
      // Builder lines start without leading whitespace; the driver follows the name
      if (!line.startsWith(' ') && line.includes('docker-container')) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function createDockerContainerBuilder(builderName: string): Promise<void> {
  await execa('docker', ['buildx', 'create', '--use', '--driver', 'docker-container', '--name', builderName]);
  await execa('docker', ['buildx', 'inspect', builderName, '--bootstrap']);
}

/**
 * Checks whether host system has [docker] installed and whether [buildx] is set up
 * properly. In case of failures, show prompt to install/setup.
 */
export async function checkDockerReadiness(): Promise<void> {
  const spinner = ora('Checking Docker availability…').start();

  if (!(await isDockerAvailable())) {
    spinner.fail('Docker is not available.');
    program.error(
      `Docker CLI is not installed or the daemon is not running.\nInstall Docker: ${pc.underline('https://docs.docker.com/get-docker/')}`,
    );
  }

  if (!(await isBuildxAvailable())) {
    spinner.fail('Docker Buildx is not available.');
    program.error(
      `Docker Buildx plugin is required for multi-platform builds.\nSee: ${pc.underline('https://docs.docker.com/build/install-buildx/')}`,
    );
  }

  if (await hasDockerContainerBuilder()) {
    spinner.succeed('Docker is ready.');
    return;
  }

  spinner.text = `Creating buildx builder "${config.dockerBuilderName}"…`;
  try {
    await createDockerContainerBuilder(config.dockerBuilderName);
  } catch (err) {
    spinner.fail(`Failed to create buildx builder "${config.dockerBuilderName}".`);
    program.error(
      `Could not create a docker-container buildx builder: ${err instanceof Error ? err.message : String(err)}\nYou can create one manually: docker buildx create --use --driver docker-container --name ${config.dockerBuilderName}`,
    );
  }

  spinner.succeed('Docker is ready.');
}

/**
 * Returns the path to the demo log file at ~/.cache/cosmo/demo/demo.log.
 * Creates the parent directory if needed.
 */
export function getDemoLogPath(): string {
  const cosmoDir = path.join(cacheDir, 'demo');
  if (!existsSync(cosmoDir)) {
    mkdirSync(cosmoDir, { recursive: true });
  }
  return path.join(cosmoDir, 'demo.log');
}

function pipeToLog(logStream: WriteStream, proc: ResultPromise) {
  proc.stdout?.pipe(logStream, { end: false });
  proc.stderr?.pipe(logStream, { end: false });
}

/**
 * Publishes demo plugins sequentially.
 * Returns [error] on first failure; spinner shows which plugin failed.
 */
export async function publishAllPlugins({
  client,
  supportDir,
  signal,
  logPath,
}: {
  client: BaseCommandOptions['client'];
  supportDir: string;
  signal: AbortSignal;
  logPath: string;
}) {
  const pluginNames = config.demoPluginNames;
  const namespace = config.demoNamespace;
  const labels = [config.demoLabelMatcher];
  // The demo router always runs in a Linux Docker container, so we need
  // linux builds for both architectures regardless of the host OS.
  const logStream = createWriteStream(logPath, { flags: 'w' });

  try {
    for (let i = 0; i < pluginNames.length; i++) {
      const pluginName = pluginNames[i];
      const pluginDir = path.join(supportDir, 'plugins', pluginName);

      const spinner = ora(`Publishing plugin ${pc.bold(pluginName)} (${i + 1}/${pluginNames.length})…`).start();

      const files = await readPluginFiles(pluginDir);
      const result = await publishPluginPipeline({
        client,
        pluginDir,
        pluginName,
        namespace,
        labels,
        platforms: getDefaultPlatforms(),
        files,
        cancelSignal: signal,
        onProcess: (proc) => pipeToLog(logStream, proc),
      });

      if (result.error) {
        spinner.fail(`Failed to publish plugin ${pc.bold(pluginName)}: ${result.error.message}`);
        return { error: result.error };
      }

      spinner.succeed(`Plugin ${pc.bold(pluginName)} published.`);
    }
  } finally {
    logStream.end();
  }

  return { error: null };
}
