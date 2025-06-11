import { rmSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { describe, test, expect } from 'vitest';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import GenerateCommand from '../src/commands/grpc/commands/generate.js';
import { Client } from '../src/core/client/client.js';

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {});
  });

describe('gRPC Generate Command', () => {
  test('should generate proto and mapping files', async () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const program = new Command();
    program.addCommand(GenerateCommand({ client }));

    const tmpDir = join(tmpdir(), `grpc-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      const command = await program.parseAsync(
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
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('should fail when output path does not exist', async () => {
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

    await expect(
      program.parseAsync(
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
      )
    ).rejects.toThrow();
  });

  test('should fail when input file does not exist', async () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const program = new Command();
    program.addCommand(GenerateCommand({ client }));

    const tmpDir = join(tmpdir(), `grpc-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
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
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('should not generate lock file when --no-lock is specified', async () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const program = new Command();
    program.addCommand(GenerateCommand({ client }));

    const tmpDir = join(tmpdir(), `grpc-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      const command = await program.parseAsync(
        [
          'generate',
          'testservice',
          '-i',
          'test/fixtures/full-schema.graphql',
          '-o',
          tmpDir,
          '--no-lock',
        ],
        {
          from: 'user',
        }
      );

      // Verify the output files exist
      expect(existsSync(join(tmpDir, 'mapping.json'))).toBe(true);
      expect(existsSync(join(tmpDir, 'service.proto'))).toBe(true);
      // Verify lock file is not generated
      expect(existsSync(join(tmpDir, 'service.proto.lock.json'))).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
