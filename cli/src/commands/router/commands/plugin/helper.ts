import type { ValidationResult } from '@wundergraph/protographic';
import logSymbols from 'log-symbols';
import Spinner from 'ora';
import pc from 'picocolors';

// Shown until users are used to proto3 optional replacing the wrapper types of earlier versions
export const OPTIONAL_SCALARS_INFO = `Nullable scalars are now generated as proto3 optional fields instead of google.protobuf wrapper types. Pass ${pc.bold('--legacy-wrapper-types')} to keep generating wrapper types.`;

/**
 * Renders a tree-formatted result display
 * @param spinner The spinner instance
 * @param title The title to display
 * @param success Whether the operation was successful
 * @param name The name of the item (e.g. plugin name)
 * @param details Key-value pairs of details to display
 * @param options.infos Notes rendered below the tree
 */
export function renderResultTree(
  spinner: ReturnType<typeof Spinner>,
  title: string,
  success: boolean,
  name: string,
  details: Record<string, string>,
  options: { infos?: string[] } = {},
) {
  const state = success ? pc.green('success') : pc.red('failed');
  const symbol = success ? pc.green('[●]') : pc.red('[●]');

  spinner.stopAndPersist({
    symbol,
    text: pc.bold(title),
  });

  const rows = Object.entries({ name, state, ...details });
  // Pad the keys so all values start in the same column
  const keyWidth = Math.max(...rows.map(([key]) => key.length));

  let output = ` ${pc.dim('│')}`;
  for (const [index, [key, value]] of rows.entries()) {
    const connector = index === rows.length - 1 ? '└─' : '├─';
    output += `\n ${pc.dim(`${connector} ${`${key}:`.padEnd(keyWidth + 1)}`)} ${value}`;
  }

  if (options.infos?.length) {
    output += '\n';
    for (const info of options.infos) {
      output += `\n ${logSymbols.info} ${info}`;
    }
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
