import 'dotenv/config';

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { FederatedGraphRepository } from '../core/repositories/FederatedGraphRepository.js';
import * as schema from '../db/schema.js';

const queryConnection = postgres(process.env.DB_URL!, {
  max: 1,
});

const db = drizzle(queryConnection, {
  schema: { ...schema },
});

const allOrgs = await db.select().from(schema.organizations).execute();

for (const organization of allOrgs) {
  console.log(`Migrating organization '${organization.name}'`);

  await db.transaction(async (trx) => {
    const federatedGraphRepository = new FederatedGraphRepository(trx, organization.id);
    const graphs = await federatedGraphRepository.list({
      limit: 100,
      offset: 0,
    });

    console.log(`Migrating ${graphs.length} graphs`);

    for (const graph of graphs) {
      console.log(`Migrating graph ${graph.name}`);

      await federatedGraphRepository.createGraphCryptoKeyPairs({
        organizationId: organization.id,
        federatedGraphId: graph.id,
      });

      console.log(`Graph '${graph.name}' migrated`);
    }
  });
  console.log(`Organization '${organization.name}' migrated`);
}

console.log(`Database migrated`);
queryConnection.end({
  timeout: 5,
});
