---
title: "Graph Feature Flags"
author: Jens Neuse
---

Graph Feature Flags are a way to enable or disable specific features in a federated graph.
This can be used to test new feature in a staging environment, or to gradually roll out a new feature to production.

## Usage

1. Create and publish a posts subgraph

```shell
wgc subgraph create posts --label team=A --routing-url https://posts.domain.com
wgc subgraph publish posts --schema ./subgraph-posts/schema.graphql
```

2. Create and publish a users subgraph

```shell
wgc subgraph create users --label team=B --routing-url https://users.domain.com
wgc subgraph publish users --schema ./subgraph-users/schema.graphql
```

3. Create a federated Graph

```shell
wgc federated-graph create production --label-matcher team=A,team=B --routing-url https://graph.domain.com/graphql
```

4. Create a feature flag for the users subgraph

```shell
wgc feature-flag create users-v2 --label team=B --routing-url https://users-v2.domain.com --subgraph users
# alias: wgc ff create
wgc feature-flag publish users-v2 --schema ./subgraph-users-v2/schema.graphql
# alias: wgc ff publish
```

Alternatively, you can create and publish a feature flag in one step:

```shell
wgc ff publish users-v2 --label team=B --routing-url https://users-v2.domain.com --schema ./subgraph-users-v2/schema.graphql --subgraph users
```

5. make a request to the federated graph with the feature flag

```shell
curl -X POST https://graph.domain.com/graphql \
  -H "Content-Type: application/json" \
  -H "X-Feature-Flag: users-v2"
  -d '{"query": "{ users { id name } }"}'
```

Feature flags can also be enabled via cookies:

```shell
curl -X POST https://graph.domain.com/graphql \
  -H "Content-Type: application/json" \
  -H "Cookie: feature-flag=users-v2"
  -d '{"query": "{ users { id name } }"}'
```

Feature flags can also be enabled via "extensions" field in the GraphQL request:

```shell
curl -X POST https://graph.domain.com/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ users { id name } }", "extensions": { "featureFlag": "users-v2" } }'
```

6. Create a second feature flag for the posts subgraph

```shell
wgc ff create posts-v2 --label team=A --routing-url https://posts-v2.domain.com --subgraph posts
wgc ff publish posts-v2 --schema ./subgraph-posts-v2/schema.graphql
```

7. Create a group feature flag

```shell
wgc feature-flag-group create v2 --label team=A --flags users-v2,posts-v2
# alias: wgc ffg create
```

8. make a request to the federated graph with the group feature flag

This will enable both the users-v2 and posts-v2 feature flags

```shell
curl -X POST https://graph.domain.com/graphql \
  -H "Content-Type: application/json" \
  -H "X-Feature-Flag: v2"
  -d '{"query": "{ users { id name } posts { id title } }"}'
```

9. Delete the group feature flag and both feature flags

```shell
wgc ffg delete v2
wgc ff delete users-v2
wgc ff delete posts-v2
```

## Context

### Feature Flags always replace the subgraph

Feature Flags are always replacing the subgraph they are associated with.
This means that a feature flag can only be associated with one subgraph at a time.
If a feature flag is associated with a subgraph, it will replace the subgraph in the federated graph.

However, it's possible to have multiple feature flags that replace the same subgraph.

Example:

You have a Subgraph `users` with two feature flags `users-v2` and `users-v3`.
If you send no feature flag, the default `users` subgraph will be used.
If you send the `users-v2` feature flag, the `users-v2` subgraph will be used.
If you send the `users-v3` feature flag, the `users-v3` subgraph will be used.

It's not possible to combine `users-v2` and `users-v3` in a single request.
You always exclusively use one feature flag per subgraph at a time.

### Conflicting Feature Flags that replace the same subgraph are allowed

It's possible to have multiple feature flags that replace the same subgraph like described above.
This is useful and allowed for testing different variants of the same subgraph.

However, a request can only contain one single feature flag or one single group feature flag at a time (see next section)
This means that at any given time, only one feature flag per subgraph can be active.

### Feature Flags that replace the same subgraph are not allowed in a group feature flag

A feature flag group is never allowed to contain multiple feature flags that replace the same subgraph.
This would result in an ambiguous configuration.

### Group Feature Flags can only contain Feature Flags

A group feature flag can only contain feature flags.
It's not possible to have a group feature flag that contains another group feature flag.

### Group Feature Flags can use regular expressions

A group feature flag can use regular expressions to match multiple feature flags.

Example:

```shell
wgc ffg create v2 --label team=A --flags *-v2
```

This would create a group feature flag that contains all feature flags that end with `-v2`.

### Limiting a feature flag to specific federated graphs

We've already established a pattern (label matching) to limit a subgraph to specific federated graphs.
The same pattern can be used to limit a feature flag to specific federated graphs.

```shell
wgc federated-graph create production --label-matcher env=staging --routing-url https://graph.domain.com/graphql
wgc ff create users-v2 --label env=staging --routing-url https://users-v2.domain.com
wgc ff publish users-v2 --schema ./subgraph-users-v2/schema.graphql
```

### Combinations of feature flags are only possible via group feature flags

In a previous version of Feature Flags, it was possible to automatically combine multiple feature flags.
This was removed because it would have resulted in a exponential number of possible combinations,
which would have required us to limit the total number of feature flags to a very low number.

Instead, we require users to explicitly create group feature flags to combine multiple feature flags.
With 20 active feature flags and 5 groups, we would have 20+5=25 possible combinations.
If all 20 feature flags were combined, we would have 20*20=400 possible combinations.

Each time a subgraph gets published, the Control Plane is required to check if all feature flags are still valid,
which means that the number of possible combinations defines the composition check runs required.

### Composition Checks need to be Feature Flag aware

When a subgraph gets published, the Control Plane needs to check if the subgraph is compatible with all active feature flags.
If errors occur, they need to be reported in such a way that the user can easily identify which feature flag caused the error.
The error will be reported in both the CLI and the Studio.

### Feature Flags must not break composition checks

At any time, all existing feature flags must be compatible with all existing subgraphs,
based on the label matching rules of the subgraphs and feature flags.

### Feature Flag names must be unique across flags and groups

Within the same namespace, feature flags and group feature flags must have unique names.
It's not allowed to have a group feature flag with the same name as a feature flag and vice versa.
It's not allowed to have a group feature flag with the same name as another group feature flag.
It's not allowed to have a feature flag with the same name as another feature flag.

### Feature Flags are namespaced

Feature Flags are namespaced.

### The Router Engine Config is aware of all Feature Flags

As we explicitly define through label matching which feature flags are active for a federated graph,
we will statically embed all possible configurations into the Router Engine Config.
The engine config will be an array with a key:value pair for the feature flag, and another key:value pair for the config.
The config will always contain a default configuration that does not contain any feature flag key.

### Router Handling of Requests with Feature Flags

If a request contains a feature flag, the Router will check if the feature flag exists in the Router Engine Config.
If it does, the Router will execute the request with the feature flag configuration.
If it does not, the Router will return a 400 Bad Request error.

### Analytics and Metrics need to take into consideration Feature Flags

Both Metrics and Tracing need to be aware of feature flags.
Each entry needs to contain the feature flag that was used for the request so that one can filter by feature flag.
It's a requirement to be able to understand metrics like error rates, latency, and throughput per feature flag.

### The Studio should show all Feature Flags

The Studio should show all feature flags that are available for a federated graph.

### The Playground needs to be aware of Feature Flags

On the Playground, it should be possible to see all available feature flags for a federated graph.
The Playground should allow selecting a feature flag from a dropdown.
The Playground should pre-select the default feature flag, which means that no feature flag is active.
Based on the selected feature flag, the Playground should set the appropriate header or cookie.

### Feature Flags must work for all types of requests

- Subscriptions over WebSocket (header, cookie, extensions)
- Queries and Mutations over HTTP (header, cookie, extensions)
- Subscriptions over SSE (header, cookie, extensions)

### Introspection needs to be aware of Feature Flags

Depending on the selected feature flag, the introspection query should return the schema that is associated with the feature flag.

### No security through obscurity

Feature Flags are not a security feature.
They are not hidden.
Publishing a feature flag is a public action.

If you need to publish a feature flag privately, create a dedicated federated graph with restricted access.

### Feature Flags info is forwarded to the Subgraph

The Router will forward the feature flag Header to Subgraphs automatically.

### Feature Flags can be listed in the Studio and the CLI

The Studio and the CLI should show all available feature flags for a federated graph.

```shell
wgc ff list # lists all feature flags and group feature flags
```

### Feature Flags can be disabled in the router.yaml

Feature Flags can be associated with a federated graph using label matching.
However, you might want to run different Routers in different networks with feature flags enabled or disabled.
For this reason, it should be possible to disable feature flags in the router.yaml and allow to configure an allow list of regexes for feature flags.

If feature flags are disabled in the router.yaml or a feature flag is not in the allow list, the Router will return a 400 Bad Request error.
If feature flags are enabled and the allow list is empty, all feature flags are allowed.
By default, feature flags are enabled and all feature flags are allowed.

```yaml
featureFlags:
  enabled: true
```

### Feature Flags can be enabled or disabled using the CLI

```shell
wgc ff enable users-v2
wgc ff disable users-v2
wgc ffg enable v2
wgc ffg disable v2
```

Disabling a FF triggers composition and removes the FF from the Router Engine Config.
Enabling a FF triggers composition and adds the FF to the Router Engine Config.
If all FFs in a FFG are disabled, the FFG is disabled.
If you enable a FFG, all FFs in the FFG must compose successfully.

Enabling/Disabling a FF/FFG is like deleting and re-adding it without losing the FF/FFG definition.
This can be useful, e.g. if a FF is incompatible with a new subgraph version and you want to temporarily disable it.