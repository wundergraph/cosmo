import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { failWith, ok, toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Output, Result } from '@wundergraph/wgc-plugin-sdk';
import { schemaPushResult } from '../common/contract.js';
import { connectHub } from '../common/hub.js';
import type { HubDependencies } from '../common/runtime.js';
import { defaultAudience, sandboxFileName, SandboxSubgraph } from '../common/sandbox-config.js';
import { loadProjectConfig } from '../common/target.js';

interface PushOptions {
  config?: string;
  sha?: string;
  audience?: string;
  json?: boolean;
}

const lastLines = (text: string): string => text.trim().split('\n').slice(-5).join('\n');

const readSubgraphSdl = async (subgraph: SandboxSubgraph, dir: string, output: Output): Promise<Result<string>> => {
  if (subgraph.source.kind === 'file') {
    const schemaPath = path.resolve(dir, subgraph.source.path);
    output.progress({ step: 'read', subject: subgraph.name, message: `Reading ${subgraph.source.path}` });
    try {
      return ok(await readFile(schemaPath, 'utf8'));
    } catch {
      return failWith({
        message: `Subgraph ${subgraph.name}: no schema file at ${schemaPath}.`,
        remediation: 'Fix the `schema` path in sandbox.yaml; it is relative to sandbox.yaml.',
        input: subgraph.source.path,
      });
    }
  }

  const { command } = subgraph.source;
  output.progress({ step: 'generate', subject: subgraph.name, message: `Running ${command}` });
  const generated = await execa(command, { shell: true, cwd: dir, reject: false });
  if (generated.exitCode !== 0) {
    return failWith({
      message: `Subgraph ${subgraph.name}: \`${command}\` exited with ${generated.exitCode ?? 'a signal'}.\n${lastLines(generated.stderr || generated.stdout)}`,
      remediation: 'Fix the `generate` command in sandbox.yaml so it prints the SDL and exits 0.',
      input: command,
    });
  }
  if (generated.stdout.trim() === '') {
    return failWith({
      message: `Subgraph ${subgraph.name}: \`${command}\` printed nothing.`,
      remediation: 'The `generate` command must print the subgraph SDL to stdout.',
      input: command,
    });
  }
  return ok(generated.stdout);
};

const resolveSha = async (flag: string | undefined, dir: string): Promise<Result<string>> => {
  const fromEnvironment = flag || process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA;
  if (fromEnvironment) {
    return ok(fromEnvironment);
  }
  const revParse = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir, reject: false });
  if (revParse.exitCode !== 0 || revParse.stdout.trim() === '') {
    return failWith({
      message: 'Could not tell which commit this schema belongs to.',
      remediation: 'Pass `--sha <commit>` or run inside a git checkout.',
    });
  }
  return ok(revParse.stdout.trim());
};

const runPush = async (options: PushOptions, { context, runtime }: HubDependencies): Promise<void> => {
  const output = context.output({ json: options.json });

  const loaded = await loadProjectConfig(runtime.cwd(), options.config);
  if (!loaded.success) {
    output.fail(toFailure(loaded));
    return;
  }
  const { config, raw, dir } = loaded.data;

  const subgraphs: Array<{ name: string; sdl: string }> = [];
  for (const subgraph of config.subgraphs) {
    const sdl = await readSubgraphSdl(subgraph, dir, output);
    if (!sdl.success) {
      output.fail(toFailure(sdl));
      return;
    }
    subgraphs.push({ name: subgraph.name, sdl: sdl.data });
  }

  const sha = await resolveSha(options.sha, dir);
  if (!sha.success) {
    output.fail(toFailure(sha));
    return;
  }

  output.progress({
    step: 'upload',
    subject: config.schema,
    message: `Uploading ${subgraphs.length} subgraph${subgraphs.length === 1 ? '' : 's'} at ${sha.data.slice(0, 12)}`,
  });
  const hub = connectHub(context, options.audience ?? config.audience ?? defaultAudience);
  const pushed = await hub.pushSchema({ sandboxYaml: raw, subgraphs, sha: sha.data }, schemaPushResult);
  if (!pushed.success) {
    output.fail(toFailure(pushed));
    return;
  }

  const { sandbox, composition } = pushed.data;
  output.progress({
    step: 'compose',
    subject: sandbox.name,
    message: `Composed with ${composition.errors.length} error(s) and ${composition.warnings.length} warning(s)`,
  });

  if (composition.errors.length > 0) {
    output.fail({
      code: 'COMPOSITION_FAILED',
      message: `Composition failed for sandbox ${sandbox.name}:\n${composition.errors.map((error) => `  - ${error}`).join('\n')}`,
      input: sandboxFileName,
      remediation: 'Fix the subgraph schemas and push again.',
      url: sandbox.url,
    });
    return;
  }

  output.result({ sha: sha.data, ...pushed.data }, (data) =>
    [
      `${pc.green('Pushed')} ${data.sandbox.name} ${pc.dim(data.sha.slice(0, 12))}`,
      ...data.composition.warnings.map((warning) => `${pc.yellow('warning')} ${warning}`),
      data.sandbox.url,
    ].join('\n'),
  );
};

export const schemaCommand = (dependencies: HubDependencies): Command =>
  new Command('schema').description('Push subgraph schemas to Hub').addCommand(
    new Command('push')
      .description(
        'Generate or read every subgraph schema in sandbox.yaml and push them to the sandbox for this commit',
      )
      .option('--config <path>', 'Path to sandbox.yaml (default: the nearest one in this or a parent directory)')
      .option('--sha <commit>', 'Commit the schemas belong to (default: GITHUB_SHA, CI_COMMIT_SHA or git HEAD)')
      .option('--audience <audience>', 'OIDC audience Hub expects from CI (default: sandbox.yaml `audience` or hub)')
      .option('--json', 'Print the result as JSON')
      .action((options: PushOptions) => runPush(options, dependencies)),
  );
