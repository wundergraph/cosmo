import { and, asc, eq, not } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/index.js';
import { billingPlans, billingSubscriptions, Feature, organizationBilling } from '../../db/schema.js';
import type { NewBillingPlan } from '../../db/models.js';
import { BillingPlanDTO, featureIds } from '../../types/index.js';
import { BillingService } from '../services/BillingService.js';
import { traced } from '../tracing.js';

/**
 * Listed on the pricing page but never checked by the controlplane, so they are not FeatureIds. The billing_plans
 * column is still typed as Feature[], which is why upsertPlans casts.
 */
const displayOnlyFeatureIds = ['retention', 'router', 'sla'] as const;

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
          id: z.enum([...featureIds, ...displayOnlyFeatureIds]),
          description: z.string().optional(),
          limit: z.number().optional(),
        }),
      ),
    }),
  ),
});

/**
 * BillingRepository for billing related operations.
 */
@traced
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

  public async upsertPlans(config: unknown) {
    const { plans } = billingSchema.parse(config);

    await this.db.transaction(async (tx) => {
      for (const [id, plan] of Object.entries(plans)) {
        const values: NewBillingPlan = {
          id,
          ...plan,
          stripePriceId: plan.stripePriceId ?? null,
          features: plan.features as Feature[],
        };

        await tx.insert(billingPlans).values(values).onConflictDoUpdate({
          target: billingPlans.id,
          set: values,
        });
      }
    });
  }

  public getPlanById(id: string) {
    return this.db.query.billingPlans.findFirst({
      where: eq(billingPlans.id, id),
    });
  }

  public insertPlan(planId: string | null, organizationId: string) {
    return this.db
      .insert(organizationBilling)
      .values({
        plan: planId,
        organizationId,
      })
      .onConflictDoUpdate({
        target: organizationBilling.organizationId,
        set: {
          plan: planId,
        },
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

  public async cancelSubscription(organizationId: string) {
    const billingService = new BillingService(this.db, this);

    const subscription = await this.getActiveSubscriptionOfOrganization(organizationId);
    if (!subscription) {
      return;
    }

    await billingService.cancelSubscription(organizationId, subscription.id, 'Deleted by api');
  }
}
