import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { CommanderError, program } from 'commander';
import { execa } from 'execa';
import { join, resolve } from 'pathe';
import pc from 'picocolors';
import { errorMessage } from '@wundergraph/wgc-plugin-sdk';
import { configFileName, loadConfig, locateConfig, subgraphSchemaFile } from '@wundergraph/wgc-plugin-sdk/config';
import type { Subgraph } from '@wundergraph/wgc-plugin-sdk/config';
import { type GeneratedProtoFiles, protoLockFile } from './grpc-generated.js';

/** One subgraph of wundergraph.yaml, as subgraph check and publish take it. */
export interface ConfigSubgraph {
  name: string;
  namespace: string;
  /** The SDL file; a `command:` source's output is written to a temporary file first. */
  schemaFile: string;
  routingUrl: string | undefined;
  /** A `kind: grpc` subgraph's proto files, which publish sends with it as a gRPC service. */
  protoFiles: GeneratedProtoFiles | undefined;
}

const routingUrlOf = (subgraph: Subgraph): string | undefined =>
  subgraph.kind === 'plugin' ? undefined : subgraph.routing_url;

/** Runs a `command:` schema source in the config's directory and keeps what it prints in a temporary file. */
const generatedSchema = async (name: string, command: string, dir: string, outDir: string): Promise<string> => {
  const generated = await execa(command, { shell: true, cwd: dir, reject: false });
  if (generated.exitCode !== 0 || generated.stdout.trim() === '') {
    program.error(
      pc.red(
        `The schema command of subgraph ${name} (\`${command}\`) ${generated.exitCode === 0 ? 'printed nothing' : `exited with ${generated.exitCode ?? 'a signal'}`}.\n${generated.stderr}`,
      ),
    );
  }
  const file = join(outDir, `${name}.graphql`);
  await writeFile(file, generated.stdout);
  return file;
};

/** The subgraphs of the wundergraph.yaml at `configFlag`, or the nearest one when the flag has no value. */
export const readConfigSubgraphs = async (configFlag: string | true, only: string | undefined) => {
  const configPath = configFlag === true ? locateConfig(process.cwd()) : configFlag;
  if (configPath === undefined) {
    program.error(pc.red(`No ${configFileName} in this directory or a parent. Pass --config <path>.`));
  }
  const loaded = await loadConfig(configPath);
  if (!loaded.success) {
    program.error(pc.red(errorMessage(loaded)));
  }
  const { config, dir, path } = loaded.data;
  const wanted = config.subgraphs.filter((subgraph) => only === undefined || subgraph.name === only);
  if (wanted.length === 0) {
    program.error(pc.red(`${path} lists no subgraph${only === undefined ? '' : ` named ${only}`}.`));
  }

  const outDir = await mkdtemp(join(tmpdir(), 'wgc-schemas-'));
  const subgraphs: ConfigSubgraph[] = [];
  for (const subgraph of wanted) {
    const file = subgraphSchemaFile(subgraph);
    const schemaFile =
      file === undefined && subgraph.kind === 'schema' && 'command' in subgraph.schema
        ? await generatedSchema(subgraph.name, subgraph.schema.command, dir, outDir)
        : resolve(dir, file ?? '');
    subgraphs.push({
      name: subgraph.name,
      namespace: config.namespace,
      schemaFile,
      routingUrl: routingUrlOf(subgraph),
      protoFiles:
        subgraph.kind === 'grpc'
          ? {
              schema: resolve(dir, subgraph.proto),
              mappings: resolve(dir, subgraph.mapping),
              lock: protoLockFile(resolve(dir, subgraph.proto)),
            }
          : undefined,
    });
  }
  return subgraphs;
};

/**
 * Runs `run` for every subgraph, each to its end even when an earlier one failed, and fails the command once when
 * any did. A subgraph's own failure exits through `program.error`, which this turns into a recorded failure.
 */
export const forEachConfigSubgraph = async (
  subgraphs: ConfigSubgraph[],
  run: (subgraph: ConfigSubgraph) => Promise<void>,
): Promise<void> => {
  program.exitOverride();
  const failed: string[] = [];
  for (const subgraph of subgraphs) {
    console.log(pc.bold(`\n${subgraph.name}`));
    process.exitCode = 0;
    try {
      await run(subgraph);
    } catch (error) {
      if (!(error instanceof CommanderError)) {
        throw error;
      }
      process.exitCode = 1;
    }
    if (process.exitCode === 1) {
      failed.push(subgraph.name);
    }
  }
  if (failed.length > 0) {
    console.error(pc.red(`\nFailed for ${failed.join(', ')}.`));
    process.exitCode = 1;
  }
};
