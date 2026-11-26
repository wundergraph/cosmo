import type { AuthContext } from '../../types/index.js';
import type { RouterOptions } from '../routes.js';
import { GraphLifecycleEventName, LifecycleGraph, OrganizationWebhookService } from './OrganizationWebhookService.js';

/** Sends GRAPH_CREATED, GRAPH_DELETED or GRAPH_MOVED to the organization's webhooks that take it. */
export function sendGraphLifecycle(
  opts: RouterOptions,
  input: {
    eventName: GraphLifecycleEventName;
    authContext: AuthContext;
    graph: LifecycleGraph;
  },
): Promise<void> {
  const { authContext, eventName, graph } = input;
  const orgWebhooks = new OrganizationWebhookService(
    opts.db,
    authContext.organizationId,
    opts.logger,
    opts.billingDefaultPlanId,
    opts.webhookProxyUrl,
  );

  return orgWebhooks.send(
    {
      eventName,
      payload: {
        graph,
        organization: {
          id: authContext.organizationId,
          slug: authContext.organizationSlug,
        },
        actor_id: authContext.userId,
        api_key_name: authContext.apiKeyName,
      },
    },
    authContext.userId,
  );
}
