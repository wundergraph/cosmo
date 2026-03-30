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
