import process from 'node:process';
import { pino } from 'pino';
import { getConfig } from './get-config.js';
import { buildDatabaseConnectionConfig } from "../core/plugins/database.js";
import postgres, { Sql } from "postgres";
import { OrganizationRepository } from "../core/repositories/OrganizationRepository.js";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import { FederatedGraphRepository } from "../core/repositories/FederatedGraphRepository.js";
import { FeatureFlagRepository } from "../core/repositories/FeatureFlagRepository.js";
import { CompositionService } from "../core/services/CompositionService.js";
import { createS3ClientConfig, extractS3BucketName } from "../core/util.js";
import { S3Client } from "@aws-sdk/client-s3";
import { DualBlobStorage, S3BlobStorage } from "../core/blobstorage/index.js";

const {
  databaseConnectionUrl,
  databaseTlsCa,
  databaseTlsCert,
  databaseTlsKey,
  s3Storage,
  s3StorageFailover,
  webhookProxyUrl,
  cdnBaseUrl,
  admissionJwtSecret,
} = getConfig();

const organizationId = process.env.ORGANIZATION_ID || '';
if (!organizationId) {
  console.error('ORGANIZATION_ID is required');
  process.exit(1);
}

const logger = pino();

let queryConnection: Sql | undefined;
try {
  // Create the database connection. TLS is optional.
  const connectionConfig = await buildDatabaseConnectionConfig({
    tls:
      databaseTlsCa || databaseTlsCert || databaseTlsKey
        ? { ca: databaseTlsCa, cert: databaseTlsCert, key: databaseTlsKey }
        : undefined,
  });

  queryConnection = postgres(databaseConnectionUrl, { ...connectionConfig });
  const db = drizzle(queryConnection, { schema: { ...schema } });

  // Ensure the organization exists in the database
  const orgRepo = new OrganizationRepository(logger, db);
  const org = await orgRepo.byId(organizationId);
  if (!org) {
    console.log(`Organization with ID "${organizationId}" not found`);
    process.exit(1);
  }

  // Ensure that the feature has not been
  const feature = await orgRepo.getFeature({
    organizationId: org.id,
    featureId: 'split-config-loading',
  });

  if (feature?.enabled) {
    console.log(`The feature has already been enable for "${org.name}" (${org.id})`);
    process.exit(1);
  }

  await db.transaction(async (tx) => {
    // Enable the feature for the organization before recomposing all the graphs/feature flags
    await tx
      .insert(schema.organizationFeatures)
      .values({
        organizationId: org.id,
        feature: 'split-config-loading',
        enabled: true,
      })
      .execute();

    // Initialize the composition service
    const compositionService = new CompositionService(
      tx,
      org.id,
      logger,
      {
        cdnBaseUrl: cdnBaseUrl ?? '',
        webhookJWTSecret: admissionJwtSecret ?? '',
      },
      getS3Storage(),
      undefined,
      webhookProxyUrl,
      true,
    );

    // Recompose all federated graphs
    const fedGraphRepo = new FederatedGraphRepository(logger, tx, org.id);
    const fedGraphs = await fedGraphRepo.list({ limit: 0, offset: 0 });

    for (const federatedGraph of fedGraphs) {
      const { compositionErrors } = await compositionService.composeAndDeployFederatedGraph({
        actorId: org.creatorUserId!,
        federatedGraph,
      });

      if (compositionErrors.length > 0) {
        console.error(`Failed to compose and deploy federated graph ${federatedGraph.id} in namespace ${federatedGraph.namespace}: ${compositionErrors[0].message}`);
      }
    }

    // Recompose all feature flags
    const featureFlagsRepo = new FeatureFlagRepository(logger, tx, org.id);
    const featureFlags = await featureFlagsRepo.getFeatureFlags({ limit: 0, offset: 0 });

    for (const { id, namespace, isEnabled } of featureFlags) {
      if (!isEnabled) {
        continue;
      }

      const featureFlag = await featureFlagsRepo.getFeatureFlagById({ featureFlagId: id, namespaceId: namespace });
      if (!featureFlag) {
        continue;
      }

      const { compositionErrors } = await compositionService.composeAndDeployFeatureFlag({
        actorId: org.creatorUserId!,
        featureFlag,
      });

      if (compositionErrors.length > 0) {
        console.error(`Failed to compose and deploy feature flag ${featureFlag.id} in namespace ${featureFlag.namespace}: ${compositionErrors[0].message}`);
      }
    }

    console.log('Feature enabled successfully');
  });
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  if (queryConnection) {
    await queryConnection.end({ timeout: 1 });
  }
}

function getS3Storage() {
  const bucketName = extractS3BucketName(s3Storage);
  const s3Config = createS3ClientConfig(bucketName, s3Storage);

  const s3Client = new S3Client(s3Config);
  const primaryBlobStorage = new S3BlobStorage(s3Client, bucketName, {
    useIndividualDeletes: true,
  });

  if (!s3StorageFailover?.url) {
    return primaryBlobStorage;
  }

  const failoverBucketName = extractS3BucketName(s3StorageFailover);
  const failoverS3Config = createS3ClientConfig(failoverBucketName, s3StorageFailover);
  const failoverS3Client = new S3Client(failoverS3Config);
  const failoverBlobStorage = new S3BlobStorage(failoverS3Client, failoverBucketName, {
    useIndividualDeletes: true,
  });

  return new DualBlobStorage(primaryBlobStorage, failoverBlobStorage);
}