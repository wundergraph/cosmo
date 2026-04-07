import fs from 'node:fs/promises';
import path from 'node:path';
import { program } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { z } from 'zod';
import { config, cacheDir } from '../../core/config.js';
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
