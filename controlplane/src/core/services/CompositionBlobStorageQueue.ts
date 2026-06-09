import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { DeploymentError } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlainMessage } from '@bufbuild/protobuf';
import { traced } from '../tracing.js';
import { ComposeAndUploadRouterConfigParams, Composer, RouterConfigUploadError } from '../composition/composer.js';
import { FederatedGraphDTO } from '../../types/index.js';
import * as schema from '../../db/schema.js';
import { ClickHouseClient } from '../clickhouse/index.js';
import { BlobStorage, PutObjectParams } from '../blobstorage/index.js';
import { AdmissionError } from './AdmissionWebhookController.js';

type QueuedAction =
  | { action: 'upload-blob'; params: PutObjectParams<Record<string, string>> }
  | { action: 'delete-blob'; graph: FederatedGraphDTO; key: string }
  | { action: 'upload-router-config'; graph: FederatedGraphDTO; params: ComposeAndUploadRouterConfigParams };

@traced
export class CompositionBlobStorageQueue {
  #queue: Array<QueuedAction> = [];

  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
    private blobStorage: BlobStorage,
    private organizationId: string,
    private admissionConfig: {
      webhookJWTSecret: string;
      cdnBaseUrl: string;
    },
    private chClient?: ClickHouseClient,
    private webhookProxyUrl?: string,
  ) {}

  enqueueBlobUpload<Metadata extends Record<string, string>>(params: PutObjectParams<Metadata>) {
    this.#queue.push({ action: 'upload-blob', params });
  }

  enqueueBlobDeletion(graph: FederatedGraphDTO, key: string) {
    this.#queue.push({ action: 'delete-blob', graph, key });
  }

  enqueueRouterConfigUpload(
    graph: FederatedGraphDTO,
    params: Omit<ComposeAndUploadRouterConfigParams, 'blobStorage' | 'admissionConfig'>,
  ) {
    this.#queue.push({
      action: 'upload-router-config',
      graph,
      params: {
        ...params,
        blobStorage: this.blobStorage,
        admissionConfig: {
          cdnBaseUrl: this.admissionConfig.cdnBaseUrl,
          jwtSecret: this.admissionConfig.webhookJWTSecret,
        },
      },
    });
  }

  async drainQueue(): Promise<PlainMessage<DeploymentError>[]> {
    const errors: PlainMessage<DeploymentError>[] = [];
    if (this.#queue.length === 0) {
      return errors;
    }

    const composer = new Composer(this.logger, this.db, this.organizationId, this.chClient, this.webhookProxyUrl);
    for (const entry of this.#queue) {
      switch (entry.action) {
        case 'upload-router-config': {
          const { errors: uploadErrors } = await composer.composeAndUploadRouterConfig(entry.params);
          errors.push(
            ...uploadErrors
              .filter((e) => e instanceof AdmissionError || e instanceof RouterConfigUploadError)
              .map((e) => ({
                federatedGraphName: entry.graph.name,
                namespace: entry.graph.namespace,
                message: e.message ?? '',
              })),
          );

          break;
        }
        case 'delete-blob': {
          try {
            await this.blobStorage.deleteObject({ key: entry.key });
          } catch (err) {
            if (err instanceof Error) {
              errors.push({
                message: err.message,
                namespace: entry.graph.namespace,
                federatedGraphName: entry.graph.name,
              });
            }
          }

          break;
        }
        case 'upload-blob': {
          try {
            await this.blobStorage.putObject(entry.params);
          } catch (err) {
            this.logger.error(`Failed to upload blob "${entry.params.key}": ${err}`);
          }
          break;
        }
      }
    }

    return errors;
  }
}
