import Table, { type Cell, type TableConstructorOptions } from 'cli-table3';
import { wrapText } from './wrap-text.js';

export interface CLITableOptions extends Omit<TableConstructorOptions, 'wordWrap' | 'wrapOnWordBoundary'> {
  columnOverhead?: number;
}

/**
 * A cli-table3 wrapper that automatically wraps cell text based on colWidths.
 * This replaces cli-table3's built-in wordWrap which deadlocks on large inputs (#2619).
 */
export class CLITable {
  private table: InstanceType<typeof Table>;
  private colWidths: (number | null)[] | undefined;
  private columnOverhead: number;

  constructor(options: CLITableOptions = {}) {
    const { columnOverhead, ...tableOptions } = options;
    this.table = new Table(tableOptions);
    this.colWidths = tableOptions.colWidths;

    const { style } = this.table.options;
    this.columnOverhead = columnOverhead ?? style['padding-left'] + style['padding-right'];
  }

  push(...rows: Cell[][]): void {
    for (const row of rows) {
      const wrapped = this.colWidths
        ? row.map((cell, i) => {
            const width = this.colWidths![i];
            if (typeof cell === 'string' && typeof width === 'number') {
              return wrapText(cell, width - this.columnOverhead);
            }
            return cell;
          })
        : row;
      this.table.push(wrapped);
    }
  }

  toString(): string {
    return this.table.toString();
  }
}
