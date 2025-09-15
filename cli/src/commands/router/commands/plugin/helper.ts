import { ValidationResult } from '@wundergraph/protographic';
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

/**
 * Renders validation warnings and errors in a consistent format
 * @param validationResult The validation result containing errors and warnings
 * @param schemaFile The path to the schema file being validated
 * @throws Error if there are validation errors
 */
export function renderValidationResults(validationResult: ValidationResult, schemaFile: string): void {
  const hasErrors = validationResult.errors.length > 0;
  const hasWarnings = validationResult.warnings.length > 0;

  if (!hasErrors && !hasWarnings) {
    return; // No issues to report
  }

  // Render warnings first (non-blocking)
  if (hasWarnings) {
    const warningSymbol = pc.yellow('[!]');
    console.log(`\n${warningSymbol} ${pc.bold('Schema validation warnings:')}`);
    console.log(` ${pc.dim('│')}`);
    console.log(` ${pc.dim('├──────── file')}: ${schemaFile}`);
    console.log(` ${pc.dim('├──── warnings')}: ${pc.yellow(validationResult.warnings.length.toString())}`);
    console.log(` ${pc.dim('│')}`);

    for (const [index, warning] of validationResult.warnings.slice(0, 10).entries()) {
      // take at max 10
      const isLast = index === validationResult.warnings.length - 1 && !hasErrors;
      const connector = isLast ? '└─' : '├─';
      console.log(` ${pc.dim(connector)} ${pc.yellow('warn')}: ${warning.replace('[Warning] ', '')}`);
    }

    if (validationResult.warnings.length > 10) {
      console.log(` ${pc.dim('└─')} ${pc.dim('...and more warnings...')}`);
    }

    if (!hasErrors) {
      console.log(` ${pc.dim('│')}`);
      console.log(` ${pc.dim('└─')} ${pc.dim('Continuing with generation despite warnings...')}\n`);
    }
  }

  // Render errors (blocking)
  if (hasErrors) {
    const errorSymbol = pc.red('[✕]');
    console.log(`\n${errorSymbol} ${pc.bold('Schema validation errors:')}`);
    console.log(` ${pc.dim('│')}`);
    console.log(` ${pc.dim('├──────── file')}: ${schemaFile}`);
    console.log(` ${pc.dim('├────── errors')}: ${pc.red(validationResult.errors.length.toString())}`);
    console.log(` ${pc.dim('│')}`);

    for (const [index, error] of validationResult.errors.slice(0, 10).entries()) {
      // take at max 10
      const isLast = index === validationResult.errors.length - 1;
      const connector = isLast ? '└─' : '├─';
      console.log(` ${pc.dim(connector)} ${pc.red('error')}: ${error.replace('[Error] ', '')}`);
    }

    if (validationResult.errors.length > 10) {
      console.log(` ${pc.dim('└─')} ${pc.dim('...and more errors...')}`);
    }

    console.log(` ${pc.dim('│')}`);
    console.log(` ${pc.dim('└─')} ${pc.dim('Generation stopped due to validation errors.')}\n`);

    throw new Error(`Schema validation failed with ${validationResult.errors.length} error(s)`);
  }
}
