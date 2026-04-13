import open, { openApp } from 'open';

/**
 * Opens a URL in the user's default browser. Cross-platform via the `open` package.
 */
export async function openUrl(url: string): Promise<{ error?: Error }> {
  try {
    await open(url);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Launches an external program by name (e.g. "google chrome", "firefox").
 */
export async function openProgram(name: string): Promise<{ error?: Error }> {
  try {
    await openApp(name);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}
