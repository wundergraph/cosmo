# Billing

Learn how to configure billing plans and the Stripe integration.
Billing plans are used to support paid subscriptions and enforce features and limits for accounts.

## Configuration

Plans can be configured in JSON and synced to the database using the `seed-billing` script.
A full example configuration can be found in `/controlplane/src/bin/billing.json`.

Each plan has a unique ID, which is used to identify the plan in the database.

```json
{
  "plans": {
    "launch@1": {
      "name": "Launch",
      "price": 499,
      "active": true,
      "stripePriceId": "price_1OOfANKHknvMloVzGQsIPwBP",
      "weight": 1,
      "features": [
        { "id": "router", "description": "Self-Hosted Router" },
        { "id": "users", "description": "10 Users", "limit": 10 },
        { "id": "federated-graphs", "description": "2 Federated Graphs", "limit": 2 },
        { "id": "requests", "description": "Up to 100M Requests per month", "limit": 100 },
        { "id": "support", "description": "Email Support" },
        { "id": "analytics-retention", "limit": 7 },
        { "id": "tracing-retention", "limit": 7 },
        { "id": "changelog-retention", "limit": 7 },
        { "id": "breaking-change-retention", "limit": 7 },
        { "id": "trace-sampling-rate", "limit": 0.1 }
      ]
    }
  }
}
```

### Grandfathering

Plans can be grandfathered by setting `active` to `false` and add a new version of the plan with the same ID and a higher version number.
For example from `launch@1` to `launch@2`.

Customers who are already subscribed to the plan will continue to use the old plan and will be able to upgrade to the new plan.
New customers will only be able to subscribe to the new plan.

### Price

The price is specified in decimal, e.g. `0.00` for free plans and `9.99` for paid plans. Use `-1` to disable pricing, eg for Enterprise plans.

### Stripe Price ID

The Stripe Price ID is used to identify the plan in Stripe.

### Weight

The weight is used to sort the plans in the UI. Plans with a lower weight will be shown first.

### Features

Features are used to describe the plan and enforce limits. Each feature has a unique ID, which is used to identify the feature and can be used to check if a feature is enabled for an account, or to check if a limit is reached.
Any feature that has a description will be shown in the UI.

## Syncing to the database

To sync the billing configuration to the database, run the following command:

```bash
cd controlplane && pnpm seed:billing

// or

DATABASE_URL=postgres://... cd controleplane && pnpm seed:billing
```

## Stripe Integration

In order to sync subscription and payment statuses a Stripe webhook needs to be configured.

### Local development

For local development you can use the Stripe CLI to forward events to your local machine.
https://dashboard.stripe.com/test/webhooks/create?endpoint_location=local

```bash
stripe listen --forward-to http://localhost:3001/webhook/stripe/events
```

### Production

The webhook can be configured in the Stripe dashboard under `Developers > Webhooks > Add endpoint`.

The endpoint URL is `https://<controlplane-domain>/webhook/stripe/events`.

## Overriding features and limits

Features and limits can be overriden for specific accounts by adding or updating entries in the `organization_features` table.
This table has a unique constraint on `organization_id` and `feature`.

Increase the user limit:

```sql
INSERT INTO public.organization_features(
    organization_id, feature, "limit")
    VALUES ('84b14c63-df43-4ae9-aed9-62fbccbbf9d3', 'users', 10);
```

Enable a feature:

```sql
INSERT INTO public.organization_features(
    organization_id, feature, enabled)
    VALUES ('84b14c63-df43-4ae9-aed9-62fbccbbf9d3', 'datadog', true);
```

Increase the trace sampling rate:

```sql
INSERT INTO public.organization_features(
    organization_id, feature, "limit")
    VALUES ('84b14c63-df43-4ae9-aed9-62fbccbbf9d3', 'trace-sampling-rate', 0.5);
```
