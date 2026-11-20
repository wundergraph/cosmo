/** Nanoseconds, as the trace RPCs report durations, in milliseconds. */
export const nsToMs = (value: bigint | number) => Number(value) / 1_000_000;

/** Milliseconds as the nanoseconds the trace RPCs take. */
export const msToNs = (value: number) => BigInt(Math.round(value * 1_000_000));

const MAX_VALUE_LENGTH = 2048;

/** Long telemetry values are cut to protect the model's context; `full` returns them whole. */
export function truncateValue(value: string, full: boolean): { value: string; truncated: boolean } {
  if (full || value.length <= MAX_VALUE_LENGTH) {
    return { value, truncated: false };
  }
  return { value: value.slice(0, MAX_VALUE_LENGTH), truncated: true };
}
