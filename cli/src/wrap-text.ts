// Content width for a 120-char cli-table3 column: 120 total - 2 padding (1 left + 1 right) - 2 borders
export const TABLE_CONTENT_WIDTH = 116;

/**
 * Wraps text to fit within a given width, breaking on word boundaries.
 * This avoids cli-table3's built-in wordWrap which can deadlock due to
 * expensive string-width/emoji-regex evaluations on large inputs (#2619).
 */
export function wrapText(text: string, maxWidth: number): string {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    let currentLine = '';
    for (const word of words) {
      if (currentLine.length === 0) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
  }
  return lines.join('\n');
}
