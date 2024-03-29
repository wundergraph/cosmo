import { and, asc, eq, not } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { billingPlans, billingSubscriptions, organizationBilling } from '../../db/schema.js';

import { BillingPlanDTO } from '../../types/index.js';

/**
 * BillingRepository for billing related operations.
 */
export class BillingRepository {
  constructor(private db: DB) {}

  public async listPlans(): Promise<BillingPlanDTO[]> {
    const plans = await this.db.query.billingPlans.findMany({
      where: eq(billingPlans.active, true),
      columns: {
        id: true,
        name: true,
        price: true,
        stripePriceId: true,
        features: true,
      },
      orderBy: [asc(billingPlans.weight)],
    });

    return plans.map(({ features, ...plan }) => {
      return {
        ...plan,
        features: features.filter(({ description }) => !!description) as unknown as {
          id: string;
          description: string;
          limit?: number;
        }[],
      };
    });
  }

  public getPlanById(id: string) {
    return this.db.query.billingPlans.findFirst({
      where: eq(billingPlans.id, id),
    });
  }

  public async setPlan(planId: string | null, organizationId: string) {
    await this.db
      .update(organizationBilling)
      .set({
        plan: planId,
      })
      .where(eq(organizationBilling.organizationId, organizationId));
  }

  public getPlanByPriceId(priceId: string) {
    return this.db.query.billingPlans.findFirst({
      where: and(eq(billingPlans.stripePriceId, priceId), not(eq(billingPlans.active, false))),
    });
  }

  public async getActiveSubscriptionOfOrganization(organizationId: string) {
    const subscription = await this.db.query.billingSubscriptions.findFirst({
      where: and(
        eq(billingSubscriptions.organizationId, organizationId),
        not(eq(billingSubscriptions.status, 'canceled')),
      ),
      columns: {
        id: true,
      },
    });

    return subscription;
  }
}
