import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import pino from 'pino';
import Stripe from 'stripe';
import { BillingRepository } from '../repositories/BillingRepository.js';

const relevantEvents = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

export type WebhookControllerOptions = {
  billingRepository: BillingRepository;
  webhookSecret: string;
  logger: pino.Logger;
};

const plugin: FastifyPluginCallback<WebhookControllerOptions> = function StripeWebhook(fastify, opts, done) {
  fastify.post('/events', {
    config: { rawBody: true },
    handler: async (req, res) => {
      if (!req.body || !req.rawBody) {
        return res.code(400).send('No body provided');
      }

      const signature = req.headers['stripe-signature'] as string;

      const event = await opts.billingRepository.stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        opts.webhookSecret,
      );

      if (relevantEvents.has(event.type)) {
        try {
          req.log.debug('Received Stripe event', event);

          switch (event.type) {
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
              const subscription = event.data.object as Stripe.Subscription;
              await opts.billingRepository.syncSubscriptionStatus(
                subscription.id,
                subscription.customer as string,
                event.type === 'customer.subscription.created',
              );
              break;
            }
            case 'checkout.session.completed': {
              const checkoutSession = event.data.object as Stripe.Checkout.Session;
              if (checkoutSession.mode === 'subscription') {
                const subscriptionId = checkoutSession.subscription;
                await opts.billingRepository.syncSubscriptionStatus(
                  subscriptionId as string,
                  checkoutSession.customer as string,
                  true,
                );
              }
              break;
            }
            default: {
              req.log.error('Unhandled relevant event', event);
              throw new Error('Unhandled relevant event');
            }
          }
        } catch (error) {
          req.log.error(error);
          return res.code(400).send('Webhook handler failed');
        }
      }

      return res.code(200).send();
    },
  });

  done();
};

export default fp(plugin, {
  encapsulate: true,
});
