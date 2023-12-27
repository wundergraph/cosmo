#!/usr/bin/env node

import 'dotenv/config';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema.js';

const databaseConnectionUrl = process.env.DB_URL || 'postgresql://postgres:changeme@localhost:5432/controlplane';

const seedBilling = async () => {
  const queryConnection = postgres(databaseConnectionUrl);
  const db = drizzle(queryConnection, { schema: { ...schema } });

  const configPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(path.dirname(fileURLToPath(import.meta.url)), 'billing.json');

  const data = readFileSync(configPath, 'utf8');
  const json = JSON.parse(data);

  const entries = Object.entries<{
    name: string;
    price: number;
    active: boolean;
    weight: number;
    stripePriceId?: string;
    features: {
      id: string;
      description: string;
      limit?: number;
    }[];
  }>(json.plans);

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

    await db
      .insert(schema.billingPlans)
      .values(values)
      .onConflictDoUpdate({
        target: schema.billingPlans.id,
        set: values,
      })
      .execute();

    console.log('Synced billing plan', id);
  }

  console.log('Seed completed');

  process.exit(0);
};

await seedBilling();
