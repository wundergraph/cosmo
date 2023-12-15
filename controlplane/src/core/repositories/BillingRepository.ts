import { and, asc, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';

import { BillingPlanDTO } from '../../types/index.js';

import billing from '../../billing.json' assert { type: 'json' };

/**
 * Repository for billing related operations.
 */
export class BillingRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public listPlans(): BillingPlanDTO[] {
    const plans = Object.entries(billing.plans).map(([id, plan]) => ({
      id,
      name: plan.name,
      price: plan.price,
      features: plan.features,
    }));

    return plans;
  }
}
