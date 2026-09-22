import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface TemplateMap {
  [key: string]: string;
}

// Compile all template subdirectories, generating <templates>/<folder>.ts in the templates root
export const templatesDir = 'src/commands/router/commands/plugin/templates';

// Convert file names to camelCase property names
function fileNameToPropertyName(fileName: string): string {
  // Remove .template extension
  let name = fileName.replace('.template', '');

  // Handle special cases for dotfiles
  if (name.startsWith('.')) {
    name = name.slice(1); // Remove the dot
  }

  // Convert to camelCase
  // Split by dots, dashes, underscores, and spaces
  const parts = name.split(/[ ._-]/);

  return parts
    .map((part, index) => {
      // Normalize all-caps words (like README -> Readme)
      if (part === part.toUpperCase() && part.length > 1) {
        part = part.charAt(0) + part.slice(1).toLowerCase();
      }

      if (index === 0) {
        // First part: lowercase first char, preserve rest
        return part.charAt(0).toLowerCase() + part.slice(1);
      }
      // Subsequent parts: uppercase first char, preserve rest
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

// The template subdirectories that are compiled into a <folder>.ts module
export function templateDirNames(baseDir: string = templatesDir): string[] {
  return readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

export function templateModuleComment(dirName: string): string {
  return `Templates for ${dirName} (templating is done by pupa)`;
}

// Renders the generated module for a template directory. The result is committed to the repo,
// so tests can re-render it to detect drift between the .template files and the compiled output.
// Returns undefined when the directory holds no templates.
export function renderTemplateModule(dir: string, comment?: string): string | undefined {
  const files = readdirSync(dir).filter((f) => f.endsWith('.template'));

  if (files.length === 0) {
    return undefined;
  }

  const templates: TemplateMap = {};

  for (const file of files) {
    const filePath = join(dir, file);
    const content = readFileSync(filePath, 'utf8');

    // Convert file name to property name
    const key = fileNameToPropertyName(file);
    templates[key] = content;
  }

  // Generate TypeScript file
  const lines: string[] = [];

  if (comment) {
    lines.push(`// ${comment}`);
  }
  lines.push('// This file is auto-generated. Do not edit manually.');
  lines.push('/* eslint-disable no-template-curly-in-string */');
  lines.push('');

  // Create const declarations
  for (const [key, content] of Object.entries(templates)) {
    lines.push(`const ${key} = ${JSON.stringify(content)};`);
    lines.push('');
  }

  // Export default object
  lines.push('export default {');
  for (const key of Object.keys(templates)) {
    lines.push(`  ${key},`);
  }
  lines.push('};');
  lines.push('');

  return lines.join('\n');
}

function compileTemplates(dir: string, outputFile: string, comment?: string) {
  const content = renderTemplateModule(dir, comment);

  if (content === undefined) {
    console.log(`No templates found in ${dir}`);
    return;
  }

  writeFileSync(outputFile, content, 'utf8');
  console.log(`Generated ${outputFile}`);
}

function main() {
  const dirNames = templateDirNames();

  if (dirNames.length === 0) {
    console.log(`No template subdirectories found in ${templatesDir}`);
    return;
  }

  for (const dirName of dirNames) {
    const dirPath = join(templatesDir, dirName);
    const outFile = join(templatesDir, `${dirName}.ts`);
    compileTemplates(dirPath, outFile, templateModuleComment(dirName));
  }
  console.log('All templates compiled successfully');
}

// Only run when executed directly (pnpm compile-templates), never when imported by tests
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
