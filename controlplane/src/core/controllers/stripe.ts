import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import pino from 'pino';
import Stripe from 'stripe';
import { BillingRepository } from '../repositories/BillingRepository.js';
import { BillingService } from '../services/BillingService.js';

const relevantEvents = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.deleted',
]);

export type WebhookControllerOptions = {
  billingService: BillingService;
  webhookSecret: string;
  logger: pino.Logger;
};

const plugin: FastifyPluginCallback<WebhookControllerOptions> = function StripeWebhook(fastify, opts, done) {
  fastify.post('/events', {
    config: { rawBody: true },
    handler: async (req, res) => {
      const log = opts.logger.child({ name: 'stripe-webhook' });

      if (!req.body || !req.rawBody) {
        return res.code(400).send('No body provided');
      }

      const signature = req.headers['stripe-signature'] as string;
      const event = opts.billingService.stripe.webhooks.constructEvent(req.rawBody, signature, opts.webhookSecret);

      if (relevantEvents.has(event.type)) {
        try {
          log.debug(event, 'Received Stripe event');

          switch (event.type) {
            case 'customer.deleted':
              await opts.billingService.deleteCustomer(event.data.object.id);
              break;
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
              const subscription = event.data.object as Stripe.Subscription;
              await opts.billingService.syncSubscriptionStatus(subscription.id, subscription.customer as string);
              break;
            }
            case 'checkout.session.completed': {
              const checkoutSession = event.data.object as Stripe.Checkout.Session;
              if (checkoutSession.mode === 'subscription') {
                const subscriptionId = checkoutSession.subscription;
                await opts.billingService.syncSubscriptionStatus(
                  subscriptionId as string,
                  checkoutSession.customer as string,
                );
              }
              break;
            }
            default: {
              log.error('Unhandled relevant event', event);
              throw new Error('Unhandled relevant event');
            }
          }
        } catch (error) {
          log.error(error);
          return res.code(400).send('Webhook handler failed');
        }
      } else {
        log.debug(event.type, 'Received unhandled Stripe event');
      }

      return res.code(200).send();
    },
  });

  done();
};

export default fp(plugin, {
  encapsulate: true,
});
