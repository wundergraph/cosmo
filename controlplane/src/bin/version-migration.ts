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

  await db.transaction(async (tx) => {
    console.log('Fetching all the federated graph schema versions');
    const federatedSchemaVersions = await tx
      .select({
        schemaVersionId: schemaVersion.id,
        routerConfig: schemaVersion.routerConfig,
        isComposable: schemaVersion.isComposable,
        compositionErrors: schemaVersion.compositionErrors,
        createdAt: schemaVersion.createdAt,
        federatedGraphId: federatedGraphs.id,
      })
      .from(schemaVersion)
      .innerJoin(targets, eq(schemaVersion.targetId, targets.id))
      .innerJoin(federatedGraphs, eq(federatedGraphs.targetId, targets.id))
      .where(eq(targets.type, 'federated'));

    console.log('Inserting the federated schema versions into graph compositions');

    await tx.insert(graphCompositions).values(
      federatedSchemaVersions.map((f) => ({
        schemaVersionId: f.schemaVersionId,
        routerConfig: f.routerConfig,
        compositionErrors: f.compositionErrors,
        isComposable: f.isComposable,
        createdAt: f.createdAt,
        federatedGraphId: f.federatedGraphId,
      })),
    );

    console.log('Fetching the latest valid federated graph schema versions');

    const latestValidFederatedSchemaVersions = await tx
      .selectDistinctOn([schemaVersion.targetId], {
        schemaVersionId: schemaVersion.id,
        targetId: schemaVersion.targetId,
        graphCompositionId: graphCompositions.id,
        federatedGraphId: federatedGraphs.id,
      })
      .from(schemaVersion)
      .innerJoin(targets, eq(schemaVersion.targetId, targets.id))
      .innerJoin(graphCompositions, eq(graphCompositions.schemaVersionId, schemaVersion.id))
      .innerJoin(federatedGraphs, eq(federatedGraphs.targetId, schemaVersion.targetId))
      .where(and(eq(schemaVersion.isComposable, true), eq(targets.type, 'federated')))
      .orderBy(schemaVersion.targetId, desc(schemaVersion.createdAt));

    console.log('Adding to Graph Composition Subgraphs table');

    for (const version of latestValidFederatedSchemaVersions) {
      console.log(
        "Fetching the subgraph's latest schema versions of the federated graph. Federated graph id:" +
          version.federatedGraphId,
      );
      const subgraphSchemaVersions = await tx
        .select({ schemaVersionId: subgraphs.schemaVersionId, createdAt: schemaVersion.createdAt })
        .from(subgraphsToFederatedGraph)
        .innerJoin(subgraphs, eq(subgraphs.id, subgraphsToFederatedGraph.subgraphId))
        .innerJoin(schemaVersion, eq(schemaVersion.id, subgraphs.schemaVersionId))
        .where(
          and(
            eq(subgraphsToFederatedGraph.federatedGraphId, version.federatedGraphId),
            isNotNull(subgraphs.schemaVersionId),
          ),
        );

      console.log(
        "Inserting the subgraph's latest schema versions of the federated graph into graph composition subgraphs. Federated graph id:" +
          version.federatedGraphId,
      );
      await tx.insert(graphCompositionSubgraphs).values(
        subgraphSchemaVersions.map((s) => ({
          graphCompositionId: version.graphCompositionId,
          schemaVersionId: s.schemaVersionId!,
          createdAt: s.createdAt,
        })),
      );
    }
  });
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
} catch (err: any) {
  console.error(err);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}
