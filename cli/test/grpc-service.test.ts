import { rmSync, mkdirSync, existsSync, writeFileSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { describe, test, expect } from 'vitest';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import GenerateCommand from '../src/commands/grpc-service/commands/generate.js';
import GRPCCommands from '../src/commands/grpc-service/index.js';
import { Client } from '../src/core/client/client.js';

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {});
  });

describe('gRPC Generate Command', () => {
  test('should generate proto and mapping files', async (testContext) => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const program = new Command();
    program.addCommand(GenerateCommand({ client }));

    const tmpDir = join(tmpdir(), `grpc-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    testContext.onTestFinished(() => {
      rmdirSync(tmpDir, { recursive: true });
    });

    await program.parseAsync(
      [
        'generate',
        'testservice',
        '-i',
        'test/fixtures/full-schema.graphql',
        '-o',
        tmpDir,
      ],
      {
        from: 'user',
      }
    );

    // Verify the output files exist
    expect(existsSync(join(tmpDir, 'mapping.json'))).toBe(true);
    expect(existsSync(join(tmpDir, 'service.proto'))).toBe(true);
    expect(existsSync(join(tmpDir, 'service.proto.lock.json'))).toBe(true);
  });

  test('should create output directory if it does not exist', async () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const program = new Command();
    program.addCommand(GenerateCommand({ client }));

    const nonExistentDir = join(tmpdir(), `grpc-test-non-existent-${Date.now()}`);

    // Ensure the directory doesn't exist
    if (existsSync(nonExistentDir)) {
      rmSync(nonExistentDir, { recursive: true, force: true });
    }

    await program.parseAsync(
      [
        'generate',
        'testservice',
        '-i',
        'test/fixtures/full-schema.graphql',
        '-o',
        nonExistentDir,
      ],
      {
        from: 'user',
      }
    );

    // Verify the output directory and files exist
    expect(existsSync(nonExistentDir)).toBe(true);
    expect(existsSync(join(nonExistentDir, 'mapping.json'))).toBe(true);
    expect(existsSync(join(nonExistentDir, 'service.proto'))).toBe(true);
    expect(existsSync(join(nonExistentDir, 'service.proto.lock.json'))).toBe(true);

    // Cleanup
    rmSync(nonExistentDir, { recursive: true, force: true });
  });

  test('should fail when input file does not exist', async (testContext) => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const program = new Command();
    program.addCommand(GenerateCommand({ client }));

    const tmpDir = join(tmpdir(), `grpc-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    testContext.onTestFinished(() => {
      rmdirSync(tmpDir, { recursive: true });
    });


    const nonExistentFile = join(tmpdir(), 'non-existent-schema.graphql');

    await expect(
      program.parseAsync(
        [
          'generate',
          'testservice',
          '-i',
          nonExistentFile,
          '-o',
          tmpDir,
        ],
        {
          from: 'user',
        }
      )
    ).rejects.toThrow();
  });

  test('should fail when output path is a file', async (testContext) => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const program = new Command();

    program.addCommand(GenerateCommand({ client }));

    const tmpDir = join(tmpdir(), `grpc-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    testContext.onTestFinished(() => {
      rmdirSync(tmpDir, { recursive: true });
    });

    const outputFile = join(tmpDir, 'output.txt');
    writeFileSync(outputFile, 'test');

    program.exitOverride(err => {
      expect(err.message).toContain(`Output directory ${outputFile} is not a directory`);
    });

    await expect(
      program.parseAsync(
        [
          'generate',
          'testservice',
          '-i',
          'test/fixtures/full-schema.graphql',
          '-o',
          outputFile,
        ],
        {
          from: 'user',
        }
      )).rejects.toThrow('process.exit unexpectedly called with "1"');
  });
});
