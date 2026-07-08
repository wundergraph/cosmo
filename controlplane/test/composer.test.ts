import { create } from '@bufbuild/protobuf';
import { RouterConfigSchema } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { describe, expect, test, vi } from 'vitest';
import type { BlobStorage } from '../src/core/blobstorage/index.js';
import { Composer, createRouterConfigMetadata } from '../src/core/composition/composer.js';

describe('Composer', () => {
  test('omits router config signature metadata when no signature is available', async () => {
    const putObject = vi.fn().mockResolvedValue(undefined);
    const graphCompositionRepository = {
      updateComposition: vi.fn(),
    };
    const composer = new Composer(
      { error: vi.fn(), debug: vi.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      graphCompositionRepository as any,
    );

    const result = await composer.uploadRouterConfig({
      actorId: 'actor-id',
      admissionConfig: {
        cdnBaseUrl: 'https://cdn.example.com',
        jwtSecret: 'secret',
      },
      blobStorage: {
        putObject,
      } as unknown as BlobStorage,
      federatedGraphId: 'federated-graph-id',
      federatedSchemaVersionId: 'schema-version-id',
      organizationId: 'organization-id',
      routerCompatibilityVersion: '1',
      routerConfig: create(RouterConfigSchema, {}),
    });

    expect(result.errors).toStrictEqual([]);
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'organization-id/federated-graph-id/routerconfigs/latest.json',
        metadata: {
          version: 'schema-version-id',
        },
      }),
    );
    expect(graphCompositionRepository.updateComposition).not.toHaveBeenCalled();
  });

  test('includes router config signature metadata when a signature is available', () => {
    expect(createRouterConfigMetadata('schema-version-id', 'signature')).toStrictEqual({
      version: 'schema-version-id',
      'signature-sha256': 'signature',
    });
  });
});
