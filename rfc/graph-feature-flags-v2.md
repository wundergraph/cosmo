---
title: "Graph Feature Flags: RFC to add feature flags into your Federated GraphQL API"
author: Jens Neuse
---

This is an extension to the initial [Graph Feature Flags RFC](./graph-feature-flags.md)
with the goal to address some shortcomings of the initial proposal and address the feedback.

The problem with the previous approach was that it doesn't scale well with the number of feature flags.
The previous approach resulted in a matrix multiplication of all feature flags,
so the complexity of calculating the composability of all feature flags was O(n^2) with n being the number of feature flags.

This RFC extension proposes an alternative approach wich a complexity of O(n+m) with n being the number of feature flags,
and m being the number of feature flag groups.

In addition, I'd like to propose a cleaner way to define and maintain feature flags,
separate from publishing subgraph schemas.

## Solving the Matrix Multiplication Problem

First, we start by publishing a base Subgraph schema:

```bash
npx wgc subgraph publish products --schema ./products.graphql --routing-url http://localhost:4001/graphql
```

Then, we publish a feature flag schema for the same subgraph:

```bash
wgc ff publish myFlag --routing-url http://localhost:4002/graphql --schema ./productsV2.graphql --mode replace --subgraph products --supergraph myGraph
```

This creates a feature flag with the name `myFlag` for the subgraph `products`.
Instead of using port 4001, we use port 4002 for the feature flag subgraph.
We use a different schema, indicated by the `--schema` flag, which contains the new features.
The `--mode replace` flag indicates that the feature flag schema should replace the base schema.
The `--subgraph products` flag indicates that the feature flag is for the `products` subgraph,
this arg is required.
The `--supergraph myGraph` flag indicates that the feature flag should only be available for the `myGraph` supergraph,
this arg is optional. If not provided, the feature flag will be applied to all supergraphs in the same namespace that the subgraph is part of.

You can delete the feature flag like this:

```bash
wgc ff delete myFlag
```

By default, a feature flag is only composed with all non-feature flag subgraphs.
If you intend to combine multiple feature flags, you can do so by grouping them:

Let's say we add a second Subgraph:

```bash
npx wgc subgraph publish users --schema ./users.graphql --routing-url http://localhost:4003/graphql
```

Next, we add a feature flag for the `users` subgraph:

```bash
wgc ff publish myFlag2 --routing-url http://localhost:4004/graphql --schema ./usersV2.graphql --mode replace --subgraph users --supergraph myGraph
```

After this, we have the following feature flags available:

- none
- myFlag (uses productsV2 and users)
- myFlag2 (uses products and usersV2)

This means that 3 possible combinations are available instead of 4.

Let's say we'd like to test both myFlag and myFlag2 together.
We can do this by grouping them:

```bash
wgc ff group myGroupFlag --flags myFlag,myFlag2
```

This creates a new feature flag `myGroupFlag` that combines `myFlag` and `myFlag2`.

The group flag can be deleted like this:

```bash
wgc ff delete myGroupFlag
```

Names of feature flags and groups must not collide.

The Router only accepts one feature flag at a time,
so if you intend to test multiple feature flags together,
you need to use a group flag.

To illustrate how this scales better than the previous approach,
let's say we have 10 feature flags and 3 groups of feature flags.

The previous approach would have resulted in 10*10=100 possible combinations.
The new approach results in 10+3=13 possible combinations.

The second approach is not just more efficient, but also more intentional.
With the first approach, we had 100-13=87 combinations that were not intended or not useful.
With the second approach, we can test each feature flag individually,
while still being able to test combinations.

## Integrating the GraphQL Playground with Feature Flags

All feature flags that are available for a Federated Graph can be listed in the GraphQL Playground as a dropdown.
By default, the feature flag is set to `default` which means that no feature flags are active.

The dropdown allows the user to select a single feature flag or a group flag in case they'd like to test multiple feature flags together.
Keep in mind that groups need to be defined using `wgc` ahead of time.
It's not possible to create arbitrary combinations of feature flags on the fly,
because we're not able to guarantee that such a combination would compose correctly.







