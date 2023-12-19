import { and, asc, eq } from 'drizzle-orm';
import Stripe from 'stripe';
import type { DB } from '../../db/index.js';
import { organizations, organizationBilling, subscriptions } from '../../db/schema.js';

import { BillingPlanDTO } from '../../types/index.js';

import billing from '../../billing.json' assert { type: 'json' };

export const toISODateTime = (secs: number) => {
  const t = new Date('1970-01-01T00:30:00Z'); // Unix epoch start.
  t.setSeconds(secs);
  return t;
};

type ValueOf<T> = T[keyof T];

const getPriceId = (p: ValueOf<typeof billing.plans>) => {
  if (!p || !('stripePriceId' in p)) {
    return;
  }

  return p.stripePriceId;
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

  public getPlanByPriceId(priceId: string) {
    const plan = Object.entries(billing.plans).find(([, plan]) => getPriceId(plan) === priceId);

    if (!plan) {
      return null;
    }

    return {
      id: plan[0],
      ...plan[1],
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
      .insert(subscriptions)
      .values({
        id: subscriptionId,
        ...values,
      })
      .onConflictDoUpdate({
        target: subscriptions.id,
        set: values,
      });

    const plan = this.getPlanByPriceId(subscription.items.data[0].price.id);

    if (plan) {
      await this.db.update(organizationBilling).set({
        plan: plan.id,
      });
    }
  };
}
