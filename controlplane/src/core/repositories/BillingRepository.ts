import { and, asc, eq, not } from 'drizzle-orm';
import Stripe from 'stripe';
import type { DB } from '../../db/index.js';
import { organizationBilling, billingSubscriptions, billingPlans } from '../../db/schema.js';

import { BillingPlanDTO } from '../../types/index.js';

export const defaultPlan = process.env.DEFAULT_PLAN || 'developer@1';

export const toISODateTime = (secs: number) => {
  const t = new Date('1970-01-01T00:30:00Z'); // Unix epoch start.
  t.setSeconds(secs);
  return t;
};

/**
 * Repository for billing related operations.
 */
export class BillingRepository {
  public stripe: Stripe;

  constructor(private db: DB) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY_LIVE ?? process.env.STRIPE_SECRET_KEY ?? '', {
      apiVersion: '2023-10-16',
      appInfo: {
        name: 'WunderGraph Cosmo',
      },
    });
  }

  private createOrRetrieveCustomerId = async ({ id, email }: { id: string; email?: string }) => {
    const billing = await this.db.query.organizationBilling.findFirst({
      where: eq(organizationBilling.organizationId, id),
      columns: {
        id: true,
        email: true,
        plan: true,
        stripeCustomerId: true,
      },
    });

    if (billing?.stripeCustomerId) {
      return billing.stripeCustomerId;
    }

    const customer = await this.stripe.customers.create({
      metadata: {
        cosmoOrganizationId: id,
      },
      email, // this can be undefined, we'll update it after upgrading the plan
    });

    await this.db
      .insert(organizationBilling)
      .values({
        organizationId: id,
        stripeCustomerId: customer.id,
        email,
      })
      .onConflictDoUpdate({
        target: organizationBilling.id,
        set: {
          organizationId: id,
          stripeCustomerId: customer.id,
          email,
        },
      });

    return customer.id;
  };

  public async listPlans(): Promise<BillingPlanDTO[]> {
    const plans = await this.db.query.billingPlans.findMany({
      where: not(eq(billingPlans.active, false)),
      orderBy: [asc(billingPlans.weight)],
    });

    return plans.map(({ active, features, ...plan }) => {
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

  public async getPlanById(id: string) {
    return await this.db.query.billingPlans.findFirst({
      where: eq(billingPlans.id, id),
    });
  }

  public async getPlanByPriceId(priceId: string) {
    return await this.db.query.billingPlans.findFirst({
      where: and(eq(billingPlans.stripePriceId, priceId), not(eq(billingPlans.active, false))),
    });
  }

  public async hasFeature(planId = 'developer@1', feature: string) {
    const plan = await this.getPlanById(planId);
    return !!plan?.features?.find((f) => f.id === feature);
  }

  public async createCheckoutSession(params: { organizationId: string; organizationSlug: string; plan: string }) {
    const plan = await this.getPlanById(params.plan);

    if (!plan?.stripePriceId) {
      throw new Error('Invalid billing plan');
    }

    const customerId = await this.createOrRetrieveCustomerId({
      id: params.organizationId,
    });

    return this.stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      billing_address_collection: 'required',
      customer: customerId,
      line_items: [
        {
          price: plan.stripePriceId,
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      success_url: `${process.env.WEB_BASE_URL}/${params.organizationSlug}/billing?success`,
      cancel_url: `${process.env.WEB_BASE_URL}/${params.organizationSlug}/billing`,
    });
  }

  public async createBillingPortalSession(params: { organizationId: string; organizationSlug: string }) {
    const billing = await this.db.query.organizationBilling.findFirst({
      where: eq(organizationBilling.organizationId, params.organizationId),
      columns: {
        id: true,
        stripeCustomerId: true,
      },
    });

    if (!billing || !billing.stripeCustomerId) {
      throw new Error('Could not find billing information for this organization');
    }

    return this.stripe.billingPortal.sessions.create({
      customer: billing.stripeCustomerId,
      return_url: `${process.env.WEB_BASE_URL}/${params.organizationSlug}/billing`,
    });
  }

  public async upgradePlan(params: { organizationId: string; plan: string }) {
    const subscription = await this.db.query.billingSubscriptions.findFirst({
      where: eq(billingSubscriptions.organizationId, params.organizationId),
      orderBy: [asc(billingSubscriptions.createdAt)],
    });

    if (!subscription) {
      throw new Error('Could not find subscription');
    }

    const plan = await this.getPlanById(params.plan);

    if (!plan?.stripePriceId) {
      throw new Error('Invalid billing plan');
    }

    const stripeSubscription = await this.stripe.subscriptions.retrieve(subscription.id);

    await this.stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: false,
      items: [
        {
          id: stripeSubscription.items.data[0].id,
          price: plan.stripePriceId,
        },
      ],
    });

    await this.db
      .update(organizationBilling)
      .set({
        plan: plan.id,
      })
      .where(eq(organizationBilling.organizationId, params.organizationId));
  }

  syncSubscriptionStatus = async (subscriptionId: string, customerId: string, isCreateEvent?: boolean) => {
    const billing = await this.db.query.organizationBilling.findFirst({
      where: eq(organizationBilling.stripeCustomerId, customerId),
      columns: {
        id: true,
        organizationId: true,
        stripeCustomerId: true,
      },
    });

    if (!billing) {
      throw new Error(`Could not find organization with with stripeCustomerId: ${customerId}`);
    }

    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['default_payment_method', 'customer'],
    });

    const values = {
      organizationId: billing.organizationId,
      metadata: subscription.metadata,
      status: subscription.status,
      priceId: subscription.items.data[0].price.id,
      quantity: 1,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt: subscription.cancel_at ? toISODateTime(subscription.cancel_at) : null,
      canceledAt: subscription.canceled_at ? toISODateTime(subscription.canceled_at) : null,
      currentPeriodStart: toISODateTime(subscription.current_period_start),
      currentPeriodEnd: toISODateTime(subscription.current_period_end),
      createdAt: toISODateTime(subscription.created),
      endedAt: subscription.ended_at ? toISODateTime(subscription.ended_at) : null,
      trialStart: subscription.trial_start ? toISODateTime(subscription.trial_start) : null,
      trialEnd: subscription.trial_end ? toISODateTime(subscription.trial_end) : null,
    };

    await this.db
      .insert(billingSubscriptions)
      .values({
        id: subscriptionId,
        ...values,
      })
      .onConflictDoUpdate({
        target: billingSubscriptions.id,
        set: values,
      });

    const plan = await this.getPlanByPriceId(subscription.items.data[0].price.id);

    if (plan) {
      await this.db.update(organizationBilling).set({
        plan: plan.id,
      });
    }
  };
}
