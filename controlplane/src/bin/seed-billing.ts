#!/usr/bin/env node

import 'dotenv/config';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pino } from 'pino';
import { z } from 'zod';

import * as schema from '../db/schema.js';
import type { FeatureIds } from '../types/index.js';
import { NewBillingPlan } from '../db/models.js';
import { OrganizationRepository } from '../core/repositories/OrganizationRepository.js';
import defaultBilling from './billing.json' with { type: 'json' };

const billingSchema = z.object({
  plans: z.record(
    z.string(),
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
          limit: z.number().optional(),
        }),
      ),
    }),
  ),
});

const databaseConnectionUrl = process.env.DB_URL || 'postgresql://postgres:changeme@localhost:5432/controlplane';

const seedBilling = async () => {
  const queryConnection = postgres(databaseConnectionUrl);
  const db = drizzle(queryConnection, { schema: { ...schema } });

  // Imported rather than read from disk, so the build ships it in dist/bin.
  const json = billingSchema.parse(
    process.argv[2] ? JSON.parse(readFileSync(path.resolve(process.cwd(), process.argv[2]), 'utf8')) : defaultBilling,
  );

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

  // Organizations created before the plans existed get the default plan's features too.
  const defaultPlan = process.env.DEFAULT_PLAN;
  if (defaultPlan) {
    const orgRepo = new OrganizationRepository(pino(), db, defaultPlan);
    const organizations = await db.select({ id: schema.organizations.id }).from(schema.organizations).execute();
    for (const organization of organizations) {
      await orgRepo.applyPlanFeatures({ organizationId: organization.id, planId: defaultPlan });
    }
    console.log(`Applied plan ${defaultPlan} to ${organizations.length} organizations`);
  }

  console.log('Seed completed');

  process.exit(0);
};

await seedBilling();
