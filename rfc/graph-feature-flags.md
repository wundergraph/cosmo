---
title: "Graph Feature Flags: RFC to add feature flags into your Federated GraphQL API"
author: Jens Neuse
---

This RFC proposes a new feature for Open Federation, which allows you to add feature flags to your Federated GraphQL API.
This feature is called Graph Feature Flags, or GFF for short.

GFF allows you to publish Subgraph Schema Changes under a feature flag.
The runtime can dynamically enable or disable feature flags for each request.

## Motivation

There are four main reasons, and the correlated problems to solve, why we want to add Graph Feature Flags to Open Federation:

1. **Feature Rollout**: Feature flags allow you to roll out new features gradually.
   You can enable a feature for a small percentage of users and monitor its performance.
   If everything goes well, you can increase the percentage of users who see the feature.
   If something goes wrong, you can disable the feature without deploying a new version of the API.
2. **Schema Evolution**: Feature flags allow you to publish Subgraph Schema Changes without breaking existing clients.
   You can add new fields or types to your schema under a feature flag.
   Existing clients can continue to use the old schema until they are ready to switch to the new schema.
   New clients will automatically use the latest version of the schema, including all feature flags.
3. **Dynamic Configuration**: Feature flags allow you to change the behavior of your API at runtime.
   You can enable or disable feature flags for each request based on the user's permissions or other criteria.
   This allows you to create personalized experiences for your users without deploying a new version of the API.
4. **Staging Environments**: Feature flags allow you to test new features in a staging environment before rolling them out to production.
   You can enable a feature flag in the staging environment to test it with real data and real users.
   If everything goes well, you can enable the feature flag in the production environment.
   If something goes wrong, you can disable the feature flag in the staging environment without affecting the production environment.

Let's break down each of these points in more detail.

### Feature Rollout

Feature flags allow you to roll out new features gradually.
Let's say you're starting with a monolithic GraphQL API and want to migrate to a Federated GraphQL API.
You've got existing clients that depend on the old schema and have certain expectations about the characteristics of the API,
like the performance of certain GraphQL Operations.

With feature flags, we can publish a new Subgraph Schema that `@overrides` a field in the old schema, but don't automatically enable it for all clients.
Instead, we can send a small percentage of traffic to the new Subgraph in a "shadow mode" and monitor its performance.
This means that the new Subgraph is used to compute the result of the GraphQL Operation, but the result is not returned to the client.
Instead, we compare the result of the newly introduced Subgraph with the result of the existing Monolith in terms of correctness and performance.

If everything goes well, we can enable the feature flag for 1% of your users, keep monitoring,
and gradually increase the percentage of traffic that is sent to the new Subgraph.
If something goes wrong, we can disable the feature flag for all users without deploying a new version of the API.

After rolling out the feature to 100% of your users, you can monitor it in production for a while and eventually publish the new Subgraph Schema without the feature flag.
You can then remove the feature flag as well as the existing logic in the Monolith that is now obsolete.

### Schema Evolution

Feature flags allow you to publish breaking changes to your schema without breaking existing clients.
You can rename a field and publish the new schema under a feature flag.
In your codebase, you can maintain two versions of the Schema, one with the old field name and one with the new field name.
You can expose the two versions of the Schema on a different path, e.g., `/v1/graphql` and `/v2/graphql`.
Existing clients can continue to use the old Schema until they are ready to switch to the new Schema.

### Dynamic Configuration

Feature flags allow you to change the behavior of your API at runtime.
Depending on the request context, e.g. through a Header, JWT Claim, or a cookie, features can be enabled or disabled.
This allows you to create personalized experiences for different users without having to deploy multiple Routers or APIs.

### Staging Environments

Feature flags allow you to test new features in a staging environment before rolling them out to production,
but more importantly, developers can test new features in a "real" environment without getting in the way of other developers.
For larger environments, it's not possible to spin up the whole infrastructure on a developer's machine.
If you want to test a new feature end-to-end, you need to have a complete staging environment that is as close to production as possible.
This means that you'll very likely have one or more frontend applications, and many Subgraphs that are part of the Federated API.
To be able to test a new feature, you need the entire stack to be running, so it's unlikely that you can run the whole stack for each feature in isolation.
As a consequence, you need a shared staging environment where developers can test their features without affecting other developers,
hence the need for feature flags so that individual developers can test their changes in as much isolation as possible.

In a staging environment, you can enable a feature flag by setting a specific cookie or header in your client.

## Summarizing the Problem

If we condense the four main reasons, we can summarize the problem as two main points:

1. **Feature Rollout**: We need a way to gradually roll out new features to our users
2. **Experimental Features**: We need a way to test new features without affecting the "main" Graph

As the two problems are slightly different,
let's discuss them one by one,
even though the solution to both problems is very similar: Feature Flags.

## Gradual Feature Rollout: The Solution

### Publishing Subgraphs with a Feature Flag & Enabling it Dynamically

Here's the default cmd to publish a new Subgraph Schema:

```bash
npx wgc subgraph publish products --schema ../demo/subgraphs/products/products.graphql --routing-url http://localhost:4001/graphql --label=team=A
```

Let's say, we'd like to use the `@override` directive that overrides a field from another Subgraph,
and we want to gradually roll out this new feature to our users.

We can add a `--feature-flag` flag to the `subgraph publish` command:

```bash
npx wgc subgraph publish products --schema ../demo/subgraphs/products/products.graphql --routing-url http://localhost:4001/v2/graphql --label=team=A --feature-flag=v2
```

This will publish the new Subgraph Schema under the feature flag `products-v2`.
Existing clients will continue to use the previous version of the Schema.

To enable the feature flag for a specific request, you can set a cookie or header in your client.
The Header Syntax is `X-WG-Feature-Flag: products.v2`.
Multiple feature flags can be enabled by separating them with a comma: `X-WG-Feature-Flag: products.v2,employees.userAvatar`.

By default, the feature flag will implicitly have a `--feature-flag-mode=replace` flag.
This means that the Subgraph with the feature flag will replace the default Subgraph.

It's also possible to use the `--feature-flag-mode=combine` flag.
This means that the Subgraph with the feature flag will be combined with the default and other Subgraphs that have the same name.
You cannot have Subgraphs with the same name and different feature flag modes.

If two or more Subgraphs with a feature flag have the replace mode, the one published last will be used.

Using the `--feature-flag-mode=combine` flag, you can publish multiple Schemas for the same Subgraph implementation,
e.g. a base Subgraph and additional Schemas under different feature flags,
allowing you to define how much functionality you want to expose to a client based on the feature flags that are enabled.

You can remove individual feature flags from a Subgraph by using the following command:

```bash
npx wgc feature-flag remove products.v2
```

You can also publish a new Subgraph Schema and remove all existing feature flags from the Subgraph by using the following command:

```bash
npx wgc subgraph publish products --schema ../demo/subgraphs/products/products.graphql --routing-url http://localhost:4001/graphql --label=team=A --remove-feature-flags
```

When adding a feature flag to a Subgraph, we create a matrix of possible combinations of feature flags.
This matrix is used to compute the Supergraph of all combinations of Subgraphs and feature flags.
By default, we will run composition checks against all possible combinations of Subgraphs and feature flags to ensure that the Supergraph is valid.
This means that future changes to any Subgraph will run composition checks against the matrix of Subgraphs and feature flags.

It's possible that you want to publish a Subgraph Schema with a feature flag for an experimental feature,
and you don't want to run composition checks for it.
This can be the case, e.g. when you're testing a new feature in a staging environment,
and you don't want to block any other developers whose Subgraphs might not be able to compose with the Schema you've just published.

To skip composition checks for a specific Subgraph, you can use the `--skip-composition-checks` flag:

```bash
npx wgc subgraph publish products --schema ../demo/subgraphs/products/products.graphql --routing-url http://localhost:4001/graphql --label=team=A --feature-flag=v2 --disable-composition-checks
```

This will publish the new Subgraph Schema, assuming that it composes with the existing Supergraph.
If it doesn't compose, the request will fail, and the Subgraph will not be published.
If future changes to other Subgraphs are incompatible with the feature flagged Subgraph,
the Subgraph will be disabled until the composition checks pass again.

This option is only advisable for staging environments and should not be used in production.

How to enable a feature flag and gradually roll out traffic to the new Subgraph is up to the client:

Add a Header Rule your Edge Gateway that sets the `X-WG-Feature-Flag` Header for 1% of your traffic.

### Monitoring Gradual Feature Rollout

A key aspect of rolling out new features gradually is monitoring.
E.g. when we move a field from a monolith to a new Subgraph,
we want to monitor the performance, latency, correctness, and error rate of the new "feature" compared to the existing solution.
If a problem arises, we want to be able to immediately disable the feature flag.
If everything goes well, we want to gradually increase the percentage of traffic that is sent to the new Subgraph.

To achieve this, we need to tag metrics and traces with the feature flags that were enabled for a specific request,
and we need to index these metrics and traces in a way that allows us to query them efficiently.

Once we have this data, we can add a new section in Cosmo Studio that shows all feature flags that are currently enabled,
and how they compare against the "main" Graph in terms of performance, correctness, and error rate.

### Improving the Developer Experience of Gradual Feature Rollout with Automation

We can further improve the developer experience of rolling out new features gradually by automating the process.
In the "Feature Flags" section of Cosmo Studio, we can add a function that will automatically roll out a new feature in steps from
1%-10% in 1% increments, then 10%-30% in 5% increments, and finally 30%-100% in 10% increments.

This function will increase the percentage of traffic that is sent to the new Subgraph based on the performance, correctness, and error rate of the new "feature" compared to the existing solution. If a threshold is exceeded, the function will stop the rollout and disable the feature flag.

What this would allow teams to do is to set up a new feature flag,
and then let the system automatically roll out the feature without requiring the platform team to deploy extra infrastructure or handle the rollout manually.

The goal here is to avoid the platform team becoming a bottleneck for rolling out new features,
but instead, to empower the teams to roll out new features safely and quickly,
and to provide them but also the platform team with the necessary tools to monitor and observe rollouts.

As you scale your API across more and more teams,
we want to make sure that the platform team can focus on the platform itself,
and not doing hand-holding for every new feature rollout,
which should be a self-service operation.

## Testing Experimental Features: The Solution

Here's the default cmd to publish a new Subgraph Schema:

```bash
npx wgc subgraph publish products --schema ../demo/subgraphs/products/products.graphql --routing-url http://localhost:4001/graphql --label=team=A
```

Let's say, we'd like to introduce a new feature in the staging environment that will change the behavior of the API dramatically.
We don't want to affect other developers who might be integration testing other features in the staging environment.
As such, we want to publish a new Subgraph Schema under a feature flag.

We can add a `--feature-flag` flag to the `subgraph publish` command:

```bash
npx wgc subgraph publish products --schema ../demo/subgraphs/products/products.graphql --routing-url http://localhost:4002/graphql --label=team=A --feature-flag=experimental --disable-composition-checks
```

We've deployed a copy of the API to a different port, and we've published a new Subgraph Schema under the feature flag `products.experimental`.
We've also disabled composition checks for this Subgraph, as we're testing a new feature that might not be compatible with changes that other developers are making.

To be able to test this new feature end-to-end, we need to enable the feature flag in our client.
We can achieve this by setting a cookie:

```bash
curl -X POST http://localhost:4002/graphql -H "Content-Type: application/json" -H "Cookie: X-WG-Feature-Flag=products.experimental" --data '{ "query": "{ products { id name } }" }'
```

This will send a request to the staging environment with the feature flag `products.experimental` enabled.
The Router in the staging environment will pick up the feature flag and use the "Graph Resolver" with the feature enabled instead of the default one.

Once the feature has been tested and the team has confidence in it,
the Subgraph Schema can be published without the feature flag,
and we can remove the feature flag from the staging environment:

```bash
npx wgc subgraph publish products --schema ../demo/subgraphs/products/products.graphql --routing-url http://localhost:4001/graphql --label=team=A --remove-feature-flags
```

Now this feature is available to all users of the staging environment.