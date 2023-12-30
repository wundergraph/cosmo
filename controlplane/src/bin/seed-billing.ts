#!/usr/bin/env node

import 'dotenv/config';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';

import * as schema from '../db/schema.js';
import type { FeatureIds } from '../types/index.js';
import { NewBillingPlan } from '../db/models.js';

const billingSchema = z.object({
  plans: z.record(
    z.object({
      name: z.string(),
      price: z.number(),
      active: z.boolean(),
      weight: z.number(),
      stripePriceId: z.string().optional(),
      features: z.array(
        z.object({
          id: z.string(),
          description: z.string().optional(),
          limit: z.number().gt(0).optional(),
        }),
      ),
    }),
  ),
});

const databaseConnectionUrl = process.env.DB_URL || 'postgresql://postgres:changeme@localhost:5432/controlplane';

const seedBilling = async () => {
  const queryConnection = postgres(databaseConnectionUrl);
  const db = drizzle(queryConnection, { schema: { ...schema } });

  const configPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(path.dirname(fileURLToPath(import.meta.url)), 'billing.json');

  const data = readFileSync(configPath, 'utf8');
  const json = billingSchema.parse(JSON.parse(data));

  const entries = Object.entries(json.plans);

  for (const [id, plan] of entries) {
    const values: NewBillingPlan = {
      id,
      name: plan.name,
      price: plan.price,
      active: plan.active,
      weight: plan.weight,
      stripePriceId: 'stripePriceId' in plan ? plan.stripePriceId : undefined,
      features: plan.features.map((feature) => ({
        ...feature,
        id: feature.id as FeatureIds,
      })),
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
