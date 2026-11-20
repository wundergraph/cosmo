/** `4m ago`, `3h ago`: how long before `now` an ISO timestamp lies, in its largest whole unit. */
export const formatAge = (timestamp: string, now: Date): string => {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
};

const durationUnits: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

/** Parses `30s`, `10m` or `2h` into milliseconds; undefined for anything else. */
export const parseDuration = (text: string): number | undefined => {
  const match = /^(\d+)([hms])$/.exec(text);
  if (!match) {
    return undefined;
  }
  return Number(match[1]) * durationUnits[match[2]];
};
