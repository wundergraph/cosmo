import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const start = '<!-- wgc-forge:start -->';
const end = '<!-- wgc-forge:end -->';

const guidance = `${start}
## Custom Cosmo Router (Forge)

This directory is a Forge workspace: it builds a Cosmo Router binary with custom Go modules compiled in.

- \`forge.yaml\` is the source of truth: the router version (\`release\`, \`rc\` or \`commit\`) and the modules. Edit it or use the commands below.
- \`forge.lock\` pins the exact router commit and every remote module version. Never edit it by hand; \`wgc forge lock\` rewrites it.
- \`modules/<name>\` holds local modules. They are built from disk and are not pinned.
- \`.forge/\` is generated (build module, binary). Never edit or commit it.

Commands (add \`--json\` for machine-readable output; progress goes to stderr):

- \`wgc forge build\` compiles the router to the \`binary\` path in forge.yaml. A failed build keeps the previous binary.
- \`wgc forge create --list-templates\` lists presets and hook templates. \`wgc forge create --preset <id>\` or \`wgc forge create --template <id> <name>\` adds one under \`modules/\`.
- \`wgc forge add <source>\` adds a local path, a Go package (\`github.com/acme/mod@v1.2.0\`) or a Git URL (\`--ref\`, \`--package\`).
- \`wgc forge lock\` re-resolves every pin, moving branches and \`latest\` forward.
- \`wgc forge router upgrade --config <router.yaml> --check <candidate>\` builds a candidate router with these modules and runs the tests against it without changing anything. Drop \`--check\` and pass \`--yes\` to adopt it when the tests pass.

Writing a module: implement the hook interfaces from \`github.com/wundergraph/cosmo/router/core\` (\`RouterOnRequestHandler\`, \`RouterMiddlewareHandler\`, \`EnginePreOriginHandler\`, \`EnginePostOriginHandler\`), register it in \`init()\` with \`core.RegisterModule\`, and read its settings from \`modules.<moduleID>\` in the router config. Run \`go mod tidy && go test ./...\` inside the module, then \`wgc forge build\`.

The upgrade test command receives \`FORGE_ROUTER_BINARY\` and \`FORGE_ROUTER_CONFIG\`. Set it once as \`test:\` in forge.yaml.
${end}
`;

export type FileAction = 'created' | 'updated' | 'kept';

/** Adds the Forge section to a guidance file, or refreshes it, leaving everything else in the file as it is. */
export const writeGuidance = async (workspace: string, fileName: string): Promise<FileAction> => {
  const filePath = path.join(workspace, fileName);
  let existing: string;
  try {
    existing = await readFile(filePath, 'utf8');
  } catch {
    await writeFile(filePath, guidance);
    return 'created';
  }

  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);
  const updated =
    startIndex !== -1 && endIndex > startIndex
      ? `${existing.slice(0, startIndex)}${guidance.trimEnd()}${existing.slice(endIndex + end.length)}`
      : `${existing.trimEnd()}\n\n${guidance}`;
  if (updated === existing) {
    return 'kept';
  }
  await writeFile(filePath, updated);
  return 'updated';
};

/** Keeps `.forge/` out of version control without touching the other ignore rules. */
export const ignoreGeneratedFiles = async (workspace: string): Promise<FileAction> => {
  const filePath = path.join(workspace, '.gitignore');
  let existing: string;
  try {
    existing = await readFile(filePath, 'utf8');
  } catch {
    await writeFile(filePath, '.forge/\n');
    return 'created';
  }

  if (existing.split('\n').some((line) => line.trim() === '.forge/' || line.trim() === '.forge')) {
    return 'kept';
  }
  await writeFile(filePath, `${existing.trimEnd()}\n.forge/\n`);
  return 'updated';
};
