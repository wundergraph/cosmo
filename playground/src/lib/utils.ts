import { BREAK, parse, visit } from 'graphql';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const bigintE3 = BigInt(1e3);
const bigintE6 = BigInt(1e6);

export const nsToTime = (ns: bigint) => {
  let seconds = Number(ns / BigInt(1e9)).toFixed(2);
  if (Number(seconds) > 1) return seconds + ' s';

  // Work with smaller units (picoseconds) to circumvent bigint division
  const ps = ns * bigintE3;
  const microseconds = Number(ps / bigintE6);
  const milliseconds = microseconds / 1e3;

  return milliseconds.toFixed(2) + ' ms';
};

const millisecondFormat = new Intl.NumberFormat('en-US', {
  style: 'unit',
  unit: 'millisecond',
  maximumFractionDigits: 0,
});

export const formatMs = (ms: number) => millisecondFormat.format(ms);

// Matches the directive node itself, so a comment or string that mentions @name does not count.
export const usesDirective = (name: string, query: string) => {
  try {
    let found = false;
    visit(parse(query), {
      Directive(node) {
        if (node.name.value === name) {
          found = true;
          return BREAK;
        }
      },
    });
    return found;
  } catch {
    return false;
  }
};
