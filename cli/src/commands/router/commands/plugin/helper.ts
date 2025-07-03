import Spinner from 'ora';
import pc from 'picocolors';

/**
 * Renders a tree-formatted result display
 * @param spinner The spinner instance
 * @param title The title to display
 * @param success Whether the operation was successful
 * @param name The name of the item (e.g. plugin name)
 * @param details Key-value pairs of details to display
 */
export function renderResultTree(
  spinner: ReturnType<typeof Spinner>,
  title: string,
  success: boolean,
  name: string,
  details: Record<string, string>,
) {
  const state = success ? pc.green('success') : pc.red('failed');
  const symbol = success ? pc.green('[●]') : pc.red('[●]');

  spinner.stopAndPersist({
    symbol,
    text: pc.bold(title),
  });

  // Build the tree with consistent formatting
  let output = ` ${pc.dim('│')}`;

  // Add the name and state first (these are always present)
  output += `\n ${pc.dim('├────────── name')}: ${name}`;
  output += `\n ${pc.dim('├───────── state')}: ${state}`;

  // Dynamically generate key formatters based on actual keys
  const keys = Object.keys(details);
  const keyFormatters: Record<string, string> = {};

  // Generate dynamic formatters for each key
  for (const key of [...keys, 'name', 'state']) {
    // Calculate the number of dashes needed to align all values
    let dashCount = 14 - key.length;
    if (dashCount < 0) {
      dashCount = 0;
    }
    keyFormatters[key] = '─'.repeat(dashCount) + ' ' + key;
  }

  // Apply fixed formatters for the standard keys
  keyFormatters.name = '────────── name';
  keyFormatters.state = '───────── state';

  // Add all the other details except the last one
  for (const key of keys.slice(0, -1)) {
    const formattedKey = keyFormatters[key];
    output += `\n ${pc.dim('├' + formattedKey)}: ${details[key]}`;
  }

  // Add the last detail with the corner character
  if (keys.length > 0) {
    const lastKey = keys.at(-1);
    const formattedKey = keyFormatters[lastKey as string];
    output += `\n ${pc.dim('└' + formattedKey)}: ${details[lastKey as string]}`;
  }

  console.log(output);
}
