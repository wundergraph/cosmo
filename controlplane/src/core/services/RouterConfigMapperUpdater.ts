import { createHash, randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { DeploymentError } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import pLimit from 'p-limit';
import Redlock from 'redlock';
import * as schema from '../../db/schema.js';
import { FederatedGraphDTO, PlainMessage } from '../../types/index.js';
import { BlobStorage } from '../blobstorage/index.js';
import { traced } from '../tracing.js';
import { retryWithBackoff } from '../util/timers.js';

const MAPPER_REBUILD_CONCURRENCY = 5;
const LOCK_ACQUISITION_TIMEOUT_IN_MILLISECONDS = 5 * 60_000;

export async function flushMapperIntoResponse<
  T extends { response?: { code: EnumStatusCode }; deploymentErrors?: PlainMessage<DeploymentError>[] },
>(mapperUpdater: RouterConfigMapperUpdater, result: T): Promise<T> {
  const deploymentErrors = await mapperUpdater.flush();
  if (deploymentErrors.length === 0) {
    return result;
  }

  return {
    ...result,
    response:
      result.response?.code === EnumStatusCode.OK
        ? { ...result.response, code: EnumStatusCode.ERR_DEPLOYMENT_FAILED }
        : result.response,
    deploymentErrors: [...deploymentErrors, ...(result.deploymentErrors ?? [])],
  };
}

// Marker error to differentiate between a lock acquisition timeout and an actual deployment error
class DeploymentFailedError extends Error {
  constructor(err: unknown) {
    super('Deployment failed', { cause: err });
  }
}

@traced
export class RouterConfigMapperUpdater {
  private readonly pendingUploads = new Map<string, Pick<FederatedGraphDTO, 'name' | 'namespace'>>();
  private readonly pendingDeletions = new Map<string, Pick<FederatedGraphDTO, 'name' | 'namespace'>>();

  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private lockAdapter: Redlock,
    private organizationId: string,
    private logger: FastifyBaseLogger,
    private blobStorage: BlobStorage,
  ) {}

  public schedule(graph: Pick<FederatedGraphDTO, 'id' | 'name' | 'namespace'>) {
    this.pendingUploads.set(graph.id, { name: graph.name, namespace: graph.namespace });
  }

  public delete(obj: Pick<FederatedGraphDTO, 'id' | 'name' | 'namespace'> & { key: string }) {
    this.pendingDeletions.set(obj.key, obj);
  }

  public async flush(): Promise<PlainMessage<DeploymentError>[]> {
    const pendingUploads = [...this.pendingUploads];
    const pendingDeletions = [...this.pendingDeletions];
    this.pendingUploads.clear();
    this.pendingDeletions.clear();

    const limit = pLimit(MAPPER_REBUILD_CONCURRENCY);
    const deploymentErrors: PlainMessage<DeploymentError>[] = [];

    await Promise.all(
      pendingUploads.map(([federatedGraphId, graph]) =>
        limit(async () => {
          try {
            await this.rebuild(federatedGraphId);
          } catch (err) {
            const error = err instanceof DeploymentFailedError ? err.cause : err;

            this.logger.error(error, `Failed to update the router config mapper of federated graph "${graph.name}"`);
            deploymentErrors.push({
              federatedGraphName: graph.name,
              namespace: graph.namespace,
              message: error instanceof Error ? error.message : 'Failed to update the router config mapper',
            });
          }
        }),
      ),
    );

    await Promise.all(
      pendingDeletions.map(([key, graph]) =>
        limit(async () => {
          try {
            await retryWithBackoff(() => this.blobStorage.deleteObject({ key }), {
              attempts: 3,
              baseInterval: 500,
              maxInterval: 15_000,
              jitter: true,
            });
          } catch (err) {
            this.logger.warn(err, `Failed to delete router config mapper "${key}"`);
            deploymentErrors.push({
              federatedGraphName: graph.name,
              namespace: graph.namespace,
              message: err instanceof Error ? err.message : 'Failed to delete router config mapper',
            });
          }
        }),
      ),
    );

    return deploymentErrors;
  }

  private rebuild(federatedGraphId: string): Promise<void> {
    // We are using Redis as lock adapter to avoid locking the database in a transaction to avoid deadlocks.
    const lockAcquisitionDeadline = Date.now() + LOCK_ACQUISITION_TIMEOUT_IN_MILLISECONDS;
    return retryWithBackoff(
      () =>
        this.lockAdapter.using(
          [`controlplane:router-config-mapper:${federatedGraphId}`],
          5000,
          {
            retryCount: 0,
            automaticExtensionThreshold: 2500,
          },
          async (signal) => {
            const routerHashesForGraph = await this.db
              .select({
                hash: schema.routerConfigHash.hash,
                featureFlagName: schema.featureFlags.name,
              })
              .from(schema.routerConfigHash)
              .leftJoin(schema.featureFlags, eq(schema.featureFlags.id, schema.routerConfigHash.featureFlagId))
              .where(eq(schema.routerConfigHash.federatedGraphId, federatedGraphId))
              .execute();

            if (signal?.aborted) {
              throw signal.error ?? new Error('Operation aborted');
            }

            const mapper: Record<string, string> = {};
            for (const routerHash of routerHashesForGraph) {
              mapper[routerHash.featureFlagName ?? ''] = routerHash.hash;
            }

            // Serialize the mapper content and generate the file signature
            const mapperVersion = randomUUID();
            const mapperContent = JSON.stringify(mapper);
            const signatureSha256 = createHash('sha256').update(mapperVersion).update(mapperContent).digest('hex');

            try {
              await retryWithBackoff(
                () =>
                  this.blobStorage.putObject({
                    key: `${this.organizationId}/${federatedGraphId}/manifest/mapper.json`,
                    abortSignal: signal,
                    body: Buffer.from(mapperContent, 'utf8'),
                    contentType: 'application/json; charset=utf-8',
                    metadata: {
                      version: mapperVersion,
                      'signature-sha256': signatureSha256,
                    },
                  }),
                {
                  attempts: 3,
                  baseInterval: 500,
                  maxInterval: 15_000,
                  jitter: true,
                  signal,
                },
              );
            } catch (err) {
              throw new DeploymentFailedError(err);
            }
          },
        ),
      {
        attempts: 500,
        baseInterval: 200,
        maxInterval: 1000,
        jitter: true,
        shouldRetry(e) {
          if (e instanceof DeploymentFailedError) {
            // We only want to retry when we were unable to acquire a lock
            return false;
          }

          return Date.now() < lockAcquisitionDeadline;
        },
      },
    );
  }
}
