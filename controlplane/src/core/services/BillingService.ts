import { and, asc, eq, not } from 'drizzle-orm';
import Stripe from 'stripe';
import type { DB } from '../../db/index.js';
import { organizationBilling, billingSubscriptions } from '../../db/schema.js';
import { toISODateTime } from '../webhooks/utils.js';
import { NewBillingSubscription } from '../../db/models.js';
import { BillingRepository } from '../repositories/BillingRepository.js';
import { AuditLogRepository } from '../repositories/AuditLogRepository.js';

/**
 * BillingService for billing related operations.
 */
export class BillingService {
  public stripe: Stripe;

  constructor(
    private db: DB,
    private billingRepository: BillingRepository,
  ) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
      apiVersion: '2023-10-16',
      appInfo: {
        name: 'WunderGraph Cosmo',
      },
    });
  }

  private upsertStripeCustomerId = async ({ id, organizationSlug }: { id: string; organizationSlug: string }) => {
    const billing = await this.db.query.organizationBilling.findFirst({
      where: eq(organizationBilling.organizationId, id),
      columns: {
        id: true,
        plan: true,
        stripeCustomerId: true,
      },
    });

    if (billing?.stripeCustomerId) {
      return billing.stripeCustomerId;
    }

    const customer = await this.stripe.customers.create({
      name: organizationSlug,
      metadata: {
        cosmoOrganizationId: id,
        cosmoOrganizationSlug: organizationSlug,
      },
    });

    await this.db
      .insert(organizationBilling)
      .values({
        organizationId: id,
        stripeCustomerId: customer.id,
      })
      .onConflictDoUpdate({
        target: organizationBilling.organizationId,
        set: {
          stripeCustomerId: customer.id,
        },
      });

    return customer.id;
  };

  public async completeCheckoutSession(subscriptionId: string, organizationId: string) {
    const billing = await this.db.query.billingSubscriptions.findFirst({
      where: eq(billingSubscriptions.id, subscriptionId),
      columns: {
        id: true,
        organizationId: true,
        priceId: true,
      },
    });

    if (!billing) {
      throw new Error(`Could not find subscription with with subscriptionId: ${subscriptionId}.`);
    }

    await this.syncSubscriptionStatus(subscriptionId, billing.organizationId);
  }

  public async createCheckoutSession(params: { organizationId: string; organizationSlug: string; plan: string }) {
    const plan = await this.billingRepository.getPlanById(params.plan);

    if (!plan?.stripePriceId) {
      throw new Error('Invalid billing plan');
    }

    const customerId = await this.upsertStripeCustomerId({
      id: params.organizationId,
      organizationSlug: params.organizationSlug,
    });

    return this.stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      billing_address_collection: 'required',
      metadata: {
        cosmoOrganizationId: params.organizationId,
      },
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

  public async deleteSubscription(subscriptionId: string) {
    const billing = await this.db.query.billingSubscriptions.findFirst({
      where: eq(billingSubscriptions.id, subscriptionId),
      columns: {
        id: true,
        organizationId: true,
        priceId: true,
      },
      with: {
        organization: {
          columns: {
            slug: true,
          },
        },
      },
    });

    if (!billing) {
      throw new Error(`Could not find subscription with with subscriptionId: ${subscriptionId}.`);
    }

    return this.db.transaction(async (tx) => {
      const billingRepository = new BillingRepository(tx);
      const auditLogRepository = new AuditLogRepository(tx);
      const plan = await billingRepository.getPlanByPriceId(billing.priceId);
      if (!plan) {
        throw new Error('Cannot find corresponding plan');
      }

      await tx.delete(billingSubscriptions).where(eq(billingSubscriptions.id, subscriptionId));
      await tx
        .update(organizationBilling)
        .set({
          plan: null,
        })
        .where(eq(organizationBilling.organizationId, billing.organizationId));

      await auditLogRepository.addAuditLog({
        organizationId: billing.organizationId,
        organizationSlug: billing.organization.slug,
        auditAction: 'subscription.deleted',
        action: 'deleted',
        auditableType: 'subscription',
        auditableDisplayName: plan.name,
        actorDisplayName: 'cosmo-bot',
        actorType: 'system',
      });
    });
  }

  public async deleteCustomer(stripeCustomerId: string) {
    const billing = await this.db.query.organizationBilling.findFirst({
      where: eq(organizationBilling.stripeCustomerId, stripeCustomerId),
      columns: {
        id: true,
        organizationId: true,
      },
    });

    if (!billing) {
      throw new Error(`Could not find stripeCustomerId: ${stripeCustomerId}`);
    }

    await this.db.delete(organizationBilling).where(eq(organizationBilling.organizationId, billing.organizationId));
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

  public async upgradePlan(params: { organizationId: string; planId: string }) {
    const subscription = await this.db.query.billingSubscriptions.findFirst({
      where: eq(billingSubscriptions.organizationId, params.organizationId),
      orderBy: [asc(billingSubscriptions.createdAt)],
    });

    if (!subscription) {
      throw new Error('Could not find subscription');
    }

    const plan = await this.billingRepository.getPlanById(params.planId);

    if (!plan?.stripePriceId) {
      throw new Error('Invalid billing plan');
    }

    const stripeSubscription = await this.stripe.subscriptions.retrieve(subscription.id);

    await this.stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: false,
      billing_cycle_anchor: 'now',
      metadata: {
        cosmoOrganizationId: params.organizationId,
      },
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

  /**
   * Sync the subscription status with the database. It upserts a organizationBilling entry which represents the
   * customer in Stripe. It also upserts a billingSubscriptions entry which represents the subscription in Stripe.
   *
   */
  private async syncSubscriptionStatus(subscriptionId: string, organizationId: string) {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['default_payment_method', 'customer'],
    });

    const values: NewBillingSubscription = {
      id: subscriptionId,
      organizationId,
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

    await this.db.insert(billingSubscriptions).values(values).onConflictDoUpdate({
      target: billingSubscriptions.id,
      set: values,
    });
  }

  public async createSubscription(subscriptionId: string, customerId: string) {
    const billing = await this.db.query.organizationBilling.findFirst({
      where: eq(organizationBilling.stripeCustomerId, customerId),
      columns: {
        id: true,
        organizationId: true,
      },
      with: {
        organization: {
          columns: {
            slug: true,
          },
        },
      },
    });

    if (!billing) {
      throw new Error(
        `Could not find organization with with stripeCustomerId: ${customerId}. This can happen when the customer is deleted in Stripe.`,
      );
    }

    await this.syncSubscriptionStatus(subscriptionId, billing.organizationId);

    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['default_payment_method', 'customer'],
    });

    const plan = await this.billingRepository.getPlanByPriceId(subscription.items.data[0].price.id);

    if (!plan) {
      throw new Error('Cannot find corresponding plan');
    }

    const auditLogRepository = new AuditLogRepository(this.db);

    await auditLogRepository.addAuditLog({
      organizationId: billing.organizationId,
      organizationSlug: billing.organization.slug,
      auditAction: 'subscription.created',
      action: 'created',
      auditableType: 'subscription',
      auditableDisplayName: plan.name,
      actorDisplayName: 'cosmo-bot',
      actorType: 'system',
    });
  }

  public async updateSubscription(subscriptionId: string, customerId: string) {
    const billing = await this.db.query.organizationBilling.findFirst({
      where: eq(organizationBilling.stripeCustomerId, customerId),
      columns: {
        id: true,
        organizationId: true,
      },
      with: {
        organization: {
          columns: {
            slug: true,
          },
        },
      },
    });

    if (!billing) {
      throw new Error(
        `Could not find organization with with stripeCustomerId: ${customerId}. This can happen when the customer is deleted in Stripe.`,
      );
    }

    await this.syncSubscriptionStatus(subscriptionId, billing.organizationId);

    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['default_payment_method', 'customer'],
    });

    const plan = await this.billingRepository.getPlanByPriceId(subscription.items.data[0].price.id);
    if (!plan) {
      throw new Error('Cannot find corresponding plan');
    }

    // Set the plan if the subscription is active or trialing (has to be set manually on the product)
    if (subscription.status === 'active' || subscription.status === 'trialing') {
      await this.db.transaction(async (tx) => {
        const billingRepository = new BillingRepository(tx);
        const auditLogRepository = new AuditLogRepository(tx);

        // Upgrade customer to the new plan
        await billingRepository.setPlan(plan.id, billing.organizationId);

        await auditLogRepository.addAuditLog({
          organizationId: billing.organizationId,
          organizationSlug: billing.organization.slug,
          auditAction: 'subscription.activated',
          action: 'activated',
          auditableType: 'subscription',
          auditableDisplayName: plan.name,
          actorDisplayName: 'cosmo-bot',
          actorType: 'system',
        });
      });
    }
    // Give users a grace period to update their payment method
    // After the grace period, the subscription will be marked as canceled
    else if (subscription.status !== 'past_due') {
      await this.db.transaction(async (tx) => {
        const billingRepository = new BillingRepository(tx);
        const auditLogRepository = new AuditLogRepository(tx);

        // Remove the plan if the subscription is no longer active
        await billingRepository.setPlan(null, billing.organizationId);
        await auditLogRepository.addAuditLog({
          organizationId: billing.organizationId,
          organizationSlug: billing.organization.slug,
          auditAction: 'subscription.canceled',
          action: 'canceled',
          auditableType: 'subscription',
          auditableDisplayName: plan.name,
          actorDisplayName: 'cosmo-bot',
          actorType: 'system',
        });
      });
    }
  }

  cancelSubscription = async (organizationId: string, subscriptionId: string, comment: string) => {
    await this.stripe.subscriptions.cancel(subscriptionId, {
      cancellation_details: {
        comment,
      },
    });

    await this.db.delete(organizationBilling).where(eq(organizationBilling.organizationId, organizationId));
  };
}
