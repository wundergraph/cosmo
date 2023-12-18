import { and, asc, eq } from 'drizzle-orm';
import Stripe from 'stripe';
import type { DB } from '../../db/index.js';
import { organizations, subscriptions } from '../../db/schema.js';

import { BillingPlanDTO } from '../../types/index.js';

import billing from '../../billing.json' assert { type: 'json' };

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
    const org = await this.db.query.organizations.findFirst({
      where: eq(organizations.id, id),
      columns: {
        id: true,
        billingEmail: true,
        stripeCustomerId: true,
      },
    });

    if (!org) {
      throw new Error(`Could not find organization with id: ${id}`);
    }

    if (org?.stripeCustomerId) {
      return org.stripeCustomerId;
    }

    const billingEmail = org.billingEmail || email;

    const customer = await this.stripe.customers.create({
      metadata: {
        cosmoId: org.id,
      },
      email: billingEmail,
    });

    await this.db
      .update(organizations)
      .set({
        stripeCustomerId: customer.id,
        billingEmail,
      })
      .where(eq(organizations.id, id))
      .execute();

    return customer.id;
  };

  public listPlans(): BillingPlanDTO[] {
    const plans = Object.entries(billing.plans).map(([id, plan]) => ({
      id,
      name: plan.name,
      price: plan.price,
      features: plan.features,
    }));

    return plans;
  }

  public getPlanById(id: keyof typeof billing.plans) {
    const plan = billing.plans[id];

    return {
      id,
      ...plan,
    };
  }

  public async createCheckoutSession(params: { organizationId: string; organizationSlug: string; plan: string }) {
    const plan = this.getPlanById(params.plan as any);

    if (!plan || !('stripePriceId' in plan)) {
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

  syncSubscriptionStatus = async (subscriptionId: string, customerId: string, createAction = false) => {
    const org = await this.db.query.organizations.findFirst({
      where: eq(organizations.stripeCustomerId, customerId),
      columns: {
        id: true,
        billingEmail: true,
        stripeCustomerId: true,
      },
    });

    if (!org) {
      throw new Error(`Could not find organization with with stripeCustomerId: ${customerId}`);
    }

    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['default_payment_method'],
    });

    const values = {
      organizationId: org.id,
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
      .insert(subscriptions)
      .values({
        id: subscriptionId,
        ...values,
      })
      .onConflictDoUpdate({
        target: subscriptions.id,
        set: values,
      });
  };
}
