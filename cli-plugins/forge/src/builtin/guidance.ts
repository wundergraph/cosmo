import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const start = '<!-- wgc-forge:start -->';
const end = '<!-- wgc-forge:end -->';

const guidanceFor = (wgcInstallArgs: string, command: string): string => `${start}
## Custom Cosmo Router (Forge)

This directory is a Forge workspace: it builds a Cosmo Router binary with custom Go modules compiled in. Forge works in the directory of \`wundergraph.yaml\`, the one config of the graph.

Install Forge globally with \`npm i -g ${wgcInstallArgs} && ${command} plugins install forge\`, or add ${command} to this checkout with \`npm i -D ${wgcInstallArgs}\`, run \`npx ${command} plugins install forge\` and prefix the commands below with \`npx\`. Run \`${command} forge --help\` and \`${command} forge <command> --help\` to discover the commands. Agents pass \`--json\` to every command; the result is JSON on stdout and progress is NDJSON on stderr. Exit 3 means the check found problems; exit 5 means the change needs \`--yes\`.

- \`wundergraph.yaml\` lists the subgraphs of the graph and their schemas under \`subgraphs\`. Its \`router\` section declares the router release (\`release\`, \`rc\` or \`commit\`) and the \`modules\`, and its \`check\` section the API design policy. Edit it by hand or with the commands below. Forge changes only \`router\`, and \`subgraphs\` when it adds a source.
- \`wundergraph.lock\` records the reviewed router revision and the full commit of every remote module. Never edit it by hand.
- \`modules/<name>\` holds local modules. They are built from disk and are not pinned.
- \`.forge/\` is generated (build module, binary). Never edit or commit it.

Commands:

- \`${command} forge build\` compiles the router to \`router.binary\` in wundergraph.yaml (default \`.forge/bin/router\`) from the locked pins. A failed build keeps the previous binary and never changes pins.
- \`${command} forge create --list-templates\` lists presets and hook templates. \`${command} forge create --preset <id> <name>\` or \`${command} forge create --template <id> <name>\` creates one under \`modules/\`.
- \`${command} forge add <source>\` registers a local path, a Go package (\`github.com/acme/mod@v1.2.0\`) or a Git URL (\`--ref\`, \`--package\`). Re-adding a registered module previews its newer selection; pass \`--yes\` to accept it.
- \`${command} forge lock\` previews the wundergraph.lock changes after a hand edit of \`router.modules\` and keeps unchanged pins. Pass \`--yes\` to apply them.
- \`${command} forge router upgrade --check --config <router.yaml> <candidate>\` builds a candidate router with these modules and runs every module's Go behaviour tests against it without changing anything. The result names each module as passed, failed or untested. A failed or untested module blocks adoption. Drop \`--check\` and pass \`--yes\` to adopt a candidate that passes.
- \`${command} forge check\` checks the subgraph schemas listed in wundergraph.yaml, reading each schema file or running its \`command\`, against the API design rules and exits 3 on a blocking finding or when the graph does not compose. Each finding has the rule, the schema coordinate, the file and line, and for a pagination finding the expected shape and a field that already follows the rule. Run it before submitting a schema change. \`${command} forge check --help\` lists the rules. Set them under \`check.rules\` in wundergraph.yaml as \`error\`, \`warn\` or \`off\`, and record approved exceptions under \`check.exceptions\`.
- \`${command} forge source add <openapi-or-proto>\` generates a Cosmo Connect subgraph from an OpenAPI 3 description (one query field per GET operation) or a gRPC proto file (one field per unary RPC). It creates \`modules/<name>\`, registers it under \`router.modules\` and adds it to \`subgraphs\` as a \`kind: grpc\` subgraph. The result has the subgraph SDL, the module path and everything that was left out. The module runs inside the router and serves the subgraph on a loopback address (\`modules.<name>.listen_addr\`), so no plugin executable is started. The module calls the first server the description names. A relative server URL is resolved against the URL the description was read from, so pass \`--served-from <url>\` with a downloaded file. \`modules.<name>.base_url\` in the router config overrides it. Postgres URLs are not supported.

Writing a module: implement the hook interfaces from \`github.com/wundergraph/cosmo/router/core\` (\`RouterOnRequestHandler\`, \`RouterMiddlewareHandler\`, \`EnginePreOriginHandler\`, \`EnginePostOriginHandler\`), register it in \`init()\` with \`core.RegisterModule\`, and read its settings from \`modules.<moduleID>\` in the router config.

Testing: run \`go mod tidy && go test ./...\` inside \`modules/<name>\` for a module's own tests. \`${command} forge router upgrade\` runs those tests for every module, local and remote, compiled against the candidate router, with \`FORGE_ROUTER_BINARY\` set to the candidate binary and \`FORGE_ROUTER_CONFIG\` to the \`--config\` file, so a test can start the router with \`--config\` and send it requests. For a remote module without tests, keep a Go test package in \`tests/<Go package path of the module>\`. A command set as \`router.test\` in wundergraph.yaml, or passed with \`--test\`, runs as well and receives the same two variables.
${end}
`;

export type FileAction = 'created' | 'updated' | 'kept';

/** Adds the Forge section to a guidance file, or refreshes it, leaving everything else in the file as it is. */
export const writeGuidance = async (
  workspace: string,
  fileName: string,
  wgcInstallArgs: string,
  command: string,
): Promise<FileAction> => {
  const guidance = guidanceFor(wgcInstallArgs, command);
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
