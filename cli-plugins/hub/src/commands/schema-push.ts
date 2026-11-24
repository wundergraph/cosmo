import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { failWith, ok, toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Output, Result } from '@wundergraph/wgc-plugin-sdk';
import { configFileName } from '@wundergraph/wgc-plugin-sdk/config';
import type { Subgraph } from '@wundergraph/wgc-plugin-sdk/config';
import { schemaPushResult } from '../common/contract.js';
import { connectHub } from '../common/hub.js';
import type { HubDependencies } from '../common/runtime.js';
import { loadProjectConfig, resolveAudience } from '../common/target.js';

interface PushOptions {
  config?: string;
  sha?: string;
  audience?: string;
  json?: boolean;
}

const lastLines = (text: string): string => text.trim().split('\n').slice(-5).join('\n');

const readSubgraphSdl = async (subgraph: Subgraph, dir: string, output: Output): Promise<Result<string>> => {
  const schema =
    subgraph.kind === 'plugin' ? { file: path.posix.join(subgraph.path, 'src', 'schema.graphql') } : subgraph.schema;
  if ('file' in schema) {
    const schemaPath = path.resolve(dir, schema.file);
    output.progress({ step: 'read', subject: subgraph.name, message: `Reading ${schema.file}` });
    try {
      return ok(await readFile(schemaPath, 'utf8'));
    } catch {
      return failWith({
        message: `Subgraph ${subgraph.name}: no schema file at ${schemaPath}.`,
        remediation: 'Fix the `schema.file` path in wundergraph.yaml; it is relative to wundergraph.yaml.',
        input: schema.file,
      });
    }
  }

  const { command } = schema;
  output.progress({ step: 'generate', subject: subgraph.name, message: `Running ${command}` });
  const generated = await execa(command, { shell: true, cwd: dir, reject: false });
  if (generated.exitCode !== 0) {
    return failWith({
      message: `Subgraph ${subgraph.name}: \`${command}\` exited with ${generated.exitCode ?? 'a signal'}.\n${lastLines(generated.stderr || generated.stdout)}`,
      remediation: 'Fix the `schema.command` in wundergraph.yaml so it prints the SDL and exits 0.',
      input: command,
    });
  }
  if (generated.stdout.trim() === '') {
    return failWith({
      message: `Subgraph ${subgraph.name}: \`${command}\` printed nothing.`,
      remediation: 'The `schema.command` must print the subgraph SDL to stdout.',
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
  const { config, dir } = loaded.data;
  const raw = await readFile(loaded.data.path, 'utf8');

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
    subject: config.graph,
    message: `Uploading ${subgraphs.length} subgraph${subgraphs.length === 1 ? '' : 's'} at ${sha.data.slice(0, 12)}`,
  });
  const hub = connectHub(context, resolveAudience(options, runtime.env));
  const pushed = await hub.pushSchema({ sandboxYaml: raw, subgraphs, sha: sha.data }, schemaPushResult);
  if (!pushed.success) {
    output.fail(toFailure(pushed));
    return;
  }

  const pushedTo = pushed.data;
  if (pushedTo.target === 'schema') {
    output.result(
      { sha: sha.data, ...pushedTo },
      (data) => `${pc.green('Pushed')} ${data.graphSlug} ${pc.dim(data.sha.slice(0, 12))}`,
    );
    return;
  }

  output.progress({
    step: 'collections',
    subject: pushedTo.sandboxName,
    message: `Collections: ${pushedTo.passed} passed, ${pushedTo.failed} failed`,
  });

  if (pushedTo.failed > 0) {
    output.fail({
      code: 'COLLECTIONS_FAILED',
      message: `${pushedTo.failed} collection operation(s) failed in sandbox ${pushedTo.sandboxName}`,
      input: configFileName,
      remediation: 'Open the sandbox in Hub to see which operations failed.',
      url: pushedTo.hubUrl,
    });
    return;
  }

  output.result({ sha: sha.data, ...pushedTo }, (data) =>
    [`${pc.green('Pushed')} ${data.sandboxName} ${pc.dim(data.sha.slice(0, 12))}`, data.endpointUrl, data.hubUrl].join(
      '\n',
    ),
  );
};

export const schemaCommand = (dependencies: HubDependencies): Command =>
  new Command('schema').description('Push subgraph schemas to Hub').addCommand(
    new Command('push')
      .description(
        'Generate or read every subgraph schema in wundergraph.yaml and push them to the sandbox for this commit',
      )
      .option('--config <path>', 'Path to wundergraph.yaml (default: the nearest one in this or a parent directory)')
      .option('--sha <commit>', 'Commit the schemas belong to (default: GITHUB_SHA, CI_COMMIT_SHA or git HEAD)')
      .option('--audience <audience>', 'OIDC audience Hub expects from CI (default: HUB_OIDC_AUDIENCE or hub)')
      .option('--json', 'Print the result as JSON')
      .action((options: PushOptions) => runPush(options, dependencies)),
  );
