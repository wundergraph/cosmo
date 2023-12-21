import 'dotenv/config';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema.js';
import billing from './billing.json' assert { type: 'json' };

const databaseConnectionUrl = process.env.DB_URL || 'postgresql://postgres:changeme@localhost:5432/controlplane';

const seedBilling = () => {
  const queryConnection = postgres(databaseConnectionUrl);
  const db = drizzle(queryConnection, { schema: { ...schema } });

  const entries = Object.entries(billing.plans);

  for (const [id, plan] of entries) {
    const values = {
      id,
      name: plan.name,
      price: plan.price,
      active: plan.active,
      weight: plan.weight,
      stripePriceId: 'stripePriceId' in plan ? plan.stripePriceId : undefined,
      features: plan.features,
    };
    db.insert(schema.billingPlans)
      .values(values)
      .onConflictDoUpdate({
        target: schema.billingPlans.id,
        set: values,
      })
      .execute();
  }

  return true;
};

await seedBilling();
