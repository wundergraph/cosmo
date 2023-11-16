import * as process from 'node:process';
import { and, eq, desc, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../db/schema.js';
import {
  federatedGraphs,
  graphCompositions,
  schemaVersion,
  subgraphsToFederatedGraph,
  targets,
  subgraphs,
  graphCompositionSubgraphs,
} from '../db/schema.js';

const databaseConnectionUrl = process.env.DB_URL || 'postgresql://postgres:changeme@localhost:5432/controlplane';

try {
  const queryConnection = postgres(databaseConnectionUrl);
  const db = drizzle(queryConnection, { schema: { ...schema } });

  // const federatedSchemaVersions = await db
  //   .select({
  //     schemaVersionId: schemaVersion.id,
  //     routerConfig: schemaVersion.routerConfig,
  //     isComposable: schemaVersion.isComposable,
  //     compositionErrors: schemaVersion.compositionErrors,
  //     createdAt: schemaVersion.createdAt,
  //     federatedGraphId: federatedGraphs.id,
  //   })
  //   .from(schemaVersion)
  //   .innerJoin(targets, eq(schemaVersion.targetId, targets.id))
  //   .innerJoin(federatedGraphs, eq(federatedGraphs.targetId, targets.id))
  //   .where(eq(targets.type, 'federated'));

  // await db.insert(graphCompositions).values(
  //   federatedSchemaVersions.map((f) => ({
  //     schemaVersionId: f.schemaVersionId,
  //     routerConfig: f.routerConfig,
  //     compositionErrors: f.compositionErrors,
  //     isComposable: f.isComposable,
  //     createdAt: f.createdAt,
  //     federatedGraphId: f.federatedGraphId,
  //   })),
  // );

  // const latestValidFederatedSchemaVersions = await db
  //   .selectDistinctOn([schemaVersion.targetId], {
  //     schemaVersionId: schemaVersion.id,
  //     targetId: schemaVersion.targetId,
  //     graphCompositionId: graphCompositions.id,
  //     federatedGraphId: federatedGraphs.id,
  //   })
  //   .from(schemaVersion)
  //   .innerJoin(targets, eq(schemaVersion.targetId, targets.id))
  //   .innerJoin(graphCompositions, eq(graphCompositions.schemaVersionId, schemaVersion.id))
  //   .innerJoin(federatedGraphs, eq(federatedGraphs.targetId, schemaVersion.targetId))
  //   .where(and(eq(schemaVersion.isComposable, true), eq(targets.type, 'federated')))
  //   .orderBy(schemaVersion.targetId, desc(schemaVersion.createdAt));

  // for (const version of latestValidFederatedSchemaVersions) {
  //   const subgraphSchemaVersions = await db
  //     .select({ schemaVersionId: subgraphs.schemaVersionId, createdAt: schemaVersion.createdAt })
  //     .from(subgraphsToFederatedGraph)
  //     .innerJoin(subgraphs, eq(subgraphs.id, subgraphsToFederatedGraph.subgraphId))
  //     .innerJoin(schemaVersion, eq(schemaVersion.id, subgraphs.schemaVersionId))
  //     .where(
  //       and(
  //         eq(subgraphsToFederatedGraph.federatedGraphId, version.federatedGraphId),
  //         isNotNull(subgraphs.schemaVersionId),
  //       ),
  //     );

  //   await db.insert(graphCompositionSubgraphs).values(
  //     subgraphSchemaVersions.map((s) => ({
  //       graphCompositionId: version.graphCompositionId,
  //       schemaVersionId: s.schemaVersionId!,
  //       createdAt: s.createdAt,
  //     })),
  //   );
  // }

  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
} catch (err: any) {
  console.error(err);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}
