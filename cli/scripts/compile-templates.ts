#!/usr/bin/env bun

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

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
      if (index === 0) {
        // First part stays lowercase
        return part.toLowerCase();
      }
      // Capitalize first letter of subsequent parts
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
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
    const content = readFileSync(filePath, 'utf-8');
    
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

  writeFileSync(outputFile, lines.join('\n'), 'utf-8');
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

console.log('✅ All templates compiled successfully!');
