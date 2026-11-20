import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const start = '<!-- wgc-forge:start -->';
const end = '<!-- wgc-forge:end -->';

const guidance = `${start}
## Custom Cosmo Router (Forge)

This directory is a Forge workspace: it builds a Cosmo Router binary with custom Go modules compiled in.

Install Forge globally with \`npm i -g wgc && wgc plugins install forge\`, or add wgc to this checkout with \`npm i -D wgc\`, run \`npx wgc plugins install forge\` and prefix the commands below with \`npx\`. Run \`wgc forge --help\` and \`wgc forge <command> --help\` to discover the commands. Agents pass \`--json\` to every command; the result is JSON on stdout and progress is NDJSON on stderr.

- \`forge.yaml\` declares the router release (\`release\`, \`rc\` or \`commit\`) and the modules. Edit the module list by hand or with the commands below.
- \`forge.lock\` records the reviewed router revision and the full commit of every remote module. Never edit it by hand.
- \`modules/<name>\` holds local modules. They are built from disk and are not pinned.
- \`graph.yaml\` lists the subgraphs and their schema files, in the input format of \`wgc router compose\`.
- \`.forge/\` is generated (build module, binary). Never edit or commit it.

Commands:

- \`wgc forge build\` compiles the router to the \`binary\` path in forge.yaml from the locked pins. A failed build keeps the previous binary and never changes pins.
- \`wgc forge create --list-templates\` lists presets and hook templates. \`wgc forge create --preset <id> <name>\` or \`wgc forge create --template <id> <name>\` creates one under \`modules/\`.
- \`wgc forge add <source>\` registers a local path, a Go package (\`github.com/acme/mod@v1.2.0\`) or a Git URL (\`--ref\`, \`--package\`). Re-adding a registered module previews its newer selection; pass \`--yes\` to accept it.
- \`wgc forge lock\` previews the forge.lock changes after a hand edit of forge.yaml and keeps unchanged pins. Pass \`--yes\` to apply them.
- \`wgc forge router upgrade --check --config <router.yaml> <candidate>\` builds a candidate router with these modules and runs every module's Go behaviour tests against it without changing anything. The result names each module as passed, failed or untested. A failed or untested module blocks adoption. Drop \`--check\` and pass \`--yes\` to adopt a candidate that passes.
- \`wgc forge check\` checks the subgraph schemas in \`graph.yaml\` against the API design rules and exits non-zero on a blocking finding or when the graph does not compose. Each finding has the rule, the schema coordinate, the file and line, and for a pagination finding the expected shape and a field that already follows the rule. Run it before submitting a schema change. \`wgc forge check --help\` lists the rules. Set them under \`check.rules\` in forge.yaml as \`error\`, \`warn\` or \`off\`, and record approved exceptions under \`check.exceptions\`.
- \`wgc forge source add <openapi-url-or-file>\` generates a Cosmo Connect subgraph from an OpenAPI 3 description: one query field per GET operation. It creates \`modules/<name>\`, registers it in forge.yaml and adds the subgraph to \`graph.yaml\`. The result has the subgraph SDL, the module path and everything that was left out. The module runs inside the router and serves the subgraph on a loopback address (\`modules.<name>.listen_addr\`), so no plugin executable is started. Set the REST API under \`modules.<name>.base_url\`. Proto files and Postgres URLs are not supported.

Writing a module: implement the hook interfaces from \`github.com/wundergraph/cosmo/router/core\` (\`RouterOnRequestHandler\`, \`RouterMiddlewareHandler\`, \`EnginePreOriginHandler\`, \`EnginePostOriginHandler\`), register it in \`init()\` with \`core.RegisterModule\`, and read its settings from \`modules.<moduleID>\` in the router config.

Testing: run \`go mod tidy && go test ./...\` inside \`modules/<name>\` for a module's own tests. \`wgc forge router upgrade\` runs those tests for every module, local and remote, compiled against the candidate router, with \`FORGE_ROUTER_BINARY\` set to the candidate binary and \`FORGE_ROUTER_CONFIG\` to the \`--config\` file, so a test can start the router with \`--config\` and send it requests. For a remote module without tests, keep a Go test package in \`tests/<Go package path of the module>\`. A command set as \`test:\` in forge.yaml, or passed with \`--test\`, runs as well and receives the same two variables.
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
