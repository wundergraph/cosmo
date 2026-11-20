import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import type { RouterOptions } from '../routes.js';
import { GovernanceUpdateReason, OrganizationWebhookService } from './OrganizationWebhookService.js';

export function sendGovernanceUpdated(
  opts: RouterOptions,
  input: {
    organizationId: string;
    organizationSlug: string;
    actorId: string;
    reason: GovernanceUpdateReason;
  },
): Promise<void> {
  const orgWebhooks = new OrganizationWebhookService(
    opts.db,
    input.organizationId,
    opts.logger,
    opts.billingDefaultPlanId,
    opts.webhookProxyUrl,
  );

  return orgWebhooks.send(
    {
      eventName: OrganizationEventName.ORGANIZATION_GOVERNANCE_UPDATED,
      payload: {
        organization: {
          id: input.organizationId,
          slug: input.organizationSlug,
        },
        actor_id: input.actorId,
        reason: input.reason,
      },
    },
    input.actorId,
  );
}
