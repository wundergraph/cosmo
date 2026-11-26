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

/** Where a gRPC subgraph's proto schema, mapping and lock are. */
export interface GeneratedProtoFiles {
  schema: string;
  mappings: string;
  lock: string;
}

async function readGeneratedFile(path: string, description: string, hint = 'Please check the path and try again.') {
  if (!existsSync(path)) {
    program.error(pc.red(pc.bold(`The ${description} '${path}' does not exist. ${hint}`)));
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

  return await readProtoFiles({
    schema: resolve(dir, 'service.proto'),
    mappings: resolve(dir, 'mapping.json'),
    lock: resolve(dir, 'service.proto.lock.json'),
  });
}

/** The lock `grpc-service generate` writes beside a proto schema, which keeps its field numbers stable. */
export const protoLockFile = (protoFile: string): string => `${protoFile}.lock.json`;

export async function readProtoFiles(files: GeneratedProtoFiles): Promise<GeneratedProto> {
  const schema = await readGeneratedFile(files.schema, 'proto schema file');
  const mappings = await readGeneratedFile(
    files.mappings,
    'proto mapping file',
    "'grpc-service generate' writes it from the subgraph schema. With --with-operations it writes a Connect RPC contract for the router instead, which has no mapping and cannot be published as a gRPC subgraph.",
  );
  const lock = await readGeneratedFile(
    files.lock,
    'proto lock file',
    "Commit the lock 'grpc-service generate' writes beside the proto, so its field numbers stay stable.",
  );
  return { schema, mappings, lock };
}
