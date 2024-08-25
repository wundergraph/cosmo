---
title: "Distributed Operation Cache"
author: Dustin Deus
date: 2024-08-25
status: Draft
---

# Distributed Operation Cache

- **Author:** Dustin Deus
- **Date:** 2024-08-25
- **Status:** Draft

## Abstract

This RFC describes a new feature to reduce the latency of the system by pre-planning the most expensive and requested operations before the router accepts traffic. We achieve this by computing the Top-N GraphQL operations available and making them available to all routers instances before they accept traffic.

## Motivation

GraphQL is a powerful tool to query data from a server. However, the flexibility of the query language comes with a cost. The cost is the complexity of the query and how expensive it is to normalize, plan and execute it. While execution performance is primarily a concern of the underlying subgraphs, the planning phase can be a unpredictable and significant latency contributor. The distributed operation cache aims to reduce this latency by pre-planning the most expensive and requested operations ahead to make it invisible to the user.

# Proposal

The distributed operation cache is semi-automatic and allows the user to push specific operations to the cache but also automatically computes the most expensive and requested operations of the last time frame (configurable). The cache has a fixed size of operations e.g. 100 (configurable) and is shared across all router instances. An operation can be a regular query, subscription, mutation or persisted operation. When the cache capacity is reached, manual operations have a higher priority than automatic operations. This allows users to manage the priority of operations in the cache themselves.

### Pushing operations to the cache

The User can push individual operations to the distributed operation cache by using the CLI:

```bash
wgc router cache add -g mygraph operations.json
```

The CLI command will add the operations from the file `operations.json` to the distributed operation cache of the graph `mygraph`. The file must contain a list of operations in JSON format. The operations can be queries, subscriptions, mutations or persisted operations.

```json5
[
  // Queries
  {
    "body": "query { ... }"
  },
  // Persisted operation
  {
    "sha256Hash": "1234567890",
    "body": "query { ... }",
  }
]
```

The cli command is idempotent and always updates the cache with the latest operations. This doesn't trigger the computation of the Top-N operations which is done periodically by the Cosmo Platform.

### Automatic operation computation

At the same time, WunderGraph Cosmo is analyzing the incoming traffic based on the OpenTelemetry metrics that each router is sending. The Cosmo Platform computes the Top-N operations for each graph and combines it with the manually added operations. The Top-N operations are then pushed to the distributed operation cache of the graph.

### Top-N computation

The Top-N computation is based on the following metrics:

- Total operation pre-execution time: Normalization, Validation, Planning
- Total request count

The Top-N computation is done for a specific time interval e.g. 3-72 hour (configurable). The operations are sorted by the pre-execution time and request count. The Top-N operations are then pushed to the distributed operation cache. Manual operations have a higher priority than automatic operations. This means when the cache capacity is reached, manual operations are moved to the cache first and automatic operations are removed.

#### Example

The following example shows the Top-5 operations of a graph. The cache capacity is 5. The operations are sorted by the total pre-execution time and request count in descending order.

```
Operation A: 400ms, 1000 requests (Manual added)
Operation B: 300ms, 500 requests (Automatic)
Operation C: 200ms, 200 requests (Automatic)
Operation D: 100ms, 100 requests (Manual added)
Operation E: 50ms, 50 requests (Automatic)
```

The user can add three more manual operations to the cache until the cache capacity is reached. This has the effect that no automatic operations can be added to the cache. In that case, we assume that the user knows better which operations are important. If the capacity is reached and the user adds another manual operation, the least expensive manual operation is removed from the cache.

### Cache update process

The router checks periodically e.g. every 5min for updates of the distributed operation cache. The cache is checked explicitly when the router starts and when the schema changes. The cache is loaded and all operations are pre-planned before the router accepts traffic. The cache is updated in the background and doesn't block the router from accepting traffic.

### Platform integration

For containerized environments like Kubernetes, users should use the readiness probe to ensure that the router is ready to accept traffic. Setting not to small values for the readiness probe timeout is recommended to ensure that the router has enough time to prepare the cache. For schema updates after startup, this process is non-blocking because the new graph schema isn't swapped until the cache is warmed up.

### Cosmo UI integration

A User can disable the distributed operation cache in the Cosmo UI. The User can see the current operations in the cache and remove them if necessary. The User can also see the current status of the cache and the last computation time.

#### Triggering the computation manually

A User is able to trigger the computation of the Top-N operations manually in the Cosmo UI. This is useful for debugging purposes.

## Router configuration

The distributed operation cache can be enabled or disabled in the router configuration file. The default is enabled. A valid Graph API key is required to fetch the operations cache from the Cosmo Platform.

```yaml
version: "1"

cache_warmup:
  enabled: true
  interval: 5m
```

_For this RFC, we only consider support for the WunderGraph Cosmo CDN._