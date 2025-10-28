import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

interface TemplateMap {
  [key: string]: string;
}

// Convert file names to camelCase property names
function fileNameToPropertyName(fileName: string): string {
  // Remove .template extension
  let name = fileName.replace('.template', '');
  
  // Handle special cases for dotfiles
  if (name.startsWith('.')) {
    name = name.substring(1); // Remove the dot
  }
  
  // Convert to camelCase
  // Split by dots, dashes, underscores, and spaces
  const parts = name.split(/[.\-_ ]/);
  
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

function compileTemplates(dir: string, outputFile: string, comment?: string) {
  const files = readdirSync(dir).filter(f => f.endsWith('.template'));
  
  if (files.length === 0) {
    console.log(`No templates found in ${dir}`);
    return;
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

  writeFileSync(outputFile, lines.join('\n'), 'utf8');
  console.log(`Generated ${outputFile} with ${files.length} templates`);
}

// Compile all template directories
const templatesDir = 'src/commands/router/commands/plugin/templates';

compileTemplates(
  join(templatesDir, 'go'),
  join(templatesDir, 'goplugin.ts'),
  'Go plugin templates (templating is done by pupa)'
);

compileTemplates(
  join(templatesDir, 'ts'),
  join(templatesDir, 'tsplugin.ts'),
  'TypeScript plugin templates (templating is done by pupa)'
);

compileTemplates(
  join(templatesDir, 'plugin'),
  join(templatesDir, 'plugin.ts'),
  'Plugin scaffolding templates (templating is done by pupa)'
);

compileTemplates(
  join(templatesDir, 'project'),
  join(templatesDir, 'project.ts'),
  'Project scaffolding templates (templating is done by pupa)'
);

console.log('All templates compiled successfully');
