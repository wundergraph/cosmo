import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { program } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';

export interface GeneratedProto {
  schema: string;
  mappings: string;
  lock: string;
}

async function readGeneratedFile(path: string, description: string): Promise<string> {
  if (!existsSync(path)) {
    program.error(pc.red(pc.bold(`The ${description} '${path}' does not exist. Please check the path and try again.`)));
  }

  const content = new TextDecoder().decode(await readFile(path));
  if (content.trim().length === 0) {
    program.error(pc.red(pc.bold(`The ${description} '${path}' is empty. Please generate it again.`)));
  }

  return content;
}

/** Reads the proto schema, mapping and lock that `grpc-service generate` writes into a folder. */
export async function readGeneratedProto(generatedDir: string): Promise<GeneratedProto> {
  const dir = resolve(generatedDir);
  if (!existsSync(dir)) {
    program.error(
      pc.red(
        pc.bold(`The gRPC subgraph generated directory '${dir}' does not exist. Please check the path and try again.`),
      ),
    );
  }

  return {
    schema: await readGeneratedFile(resolve(dir, 'service.proto'), 'proto schema file'),
    mappings: await readGeneratedFile(resolve(dir, 'mapping.json'), 'proto mapping file'),
    lock: await readGeneratedFile(resolve(dir, 'service.proto.lock.json'), 'proto lock file'),
  };
}
