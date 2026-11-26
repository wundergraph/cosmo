import { Writable } from 'node:stream';
import { expect, test } from 'vitest';
import ora from 'ora';

/** A terminal without a size, as an agent's or CI's pseudo-terminal often is. */
class SizelessTerminal extends Writable {
  isTTY = true;
  columns = 0;
  writes = 0;

  cursorTo(): boolean {
    return this.write('');
  }

  clearLine(): boolean {
    return this.write('');
  }

  moveCursor(): boolean {
    return this.write('');
  }

  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    callback();
  }

  override write(chunk: string | Uint8Array): boolean {
    this.writes += 1;
    if (this.writes > 1000) {
      throw new Error('the spinner keeps clearing lines');
    }
    return super.write(chunk);
  }
}

test('a spinner on a terminal that reports 0 columns clears its own line and finishes', () => {
  const stream = new SizelessTerminal();

  const spinner = ora({ text: 'Monograph is being migrated...', stream, isEnabled: true }).start();
  spinner.succeed('Successfully migrated storefront');

  expect(stream.writes).toBeLessThan(20);
});
