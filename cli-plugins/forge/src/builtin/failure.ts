/** The last lines of a tool's output, which is where Go and git print what went wrong. */
export const lastLines = (text: string, count = 20): string => text.trim().split('\n').slice(-count).join('\n');
