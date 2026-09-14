export function normalizeString(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}
