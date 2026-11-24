import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { RunMigration } from '../src/core/migrate.js';
import { BillingRepository } from '../src/core/repositories/BillingRepository.js';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import * as schema from '../src/db/schema.js';

const plan = (overrides: Record<string, unknown> = {}) => ({
  name: 'Plan',
  price: 0,
  active: true,
  weight: 0,
  features: [],
  ...overrides,
});

describe('BillingRepository.upsertPlans', () => {
  let dbname: string;
  let queryConnection: postgres.Sql;
  let billingRepository: BillingRepository;

  beforeAll(async () => {
    dbname = await beforeAllSetup();
    const url = `postgresql://postgres:changeme@localhost:5432/${dbname}`;
    await RunMigration(url);
    queryConnection = postgres(url, { max: 1 });
    billingRepository = new BillingRepository(drizzle(queryConnection, { schema }));
  });

  afterAll(async () => {
    await queryConnection.end({ timeout: 5 });
    await afterAllSetup(dbname);
  });

  test('clears a stripePriceId that was removed from the config', async () => {
    const id = genID('plan');
    await billingRepository.upsertPlans({ plans: { [id]: plan({ stripePriceId: 'price_old' }) } });

    await billingRepository.upsertPlans({ plans: { [id]: plan() } });

    expect((await billingRepository.getPlanById(id))?.stripePriceId).toBeNull();
  });

  test('keeps earlier plans unchanged when a later plan fails to write', async () => {
    const id = genID('plan');
    await billingRepository.upsertPlans({ plans: { [id]: plan({ name: 'Before' }) } });

    // The price overflows the integer column, so the second upsert fails in Postgres.
    const upsert = billingRepository.upsertPlans({
      plans: { [id]: plan({ name: 'After' }), [genID('plan')]: plan({ price: 2 ** 31 }) },
    });

    await expect(upsert).rejects.toThrow();
    expect((await billingRepository.getPlanById(id))?.name).toBe('Before');
  });
});
