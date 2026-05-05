# RFC-004: Schema-Level Delivery Guarantee Directive

**Date:** 2026-05-05  
**Status:** Draft  
**Author:** TBD  
**Related:** [at-least-once-research.md](./at-least-once-research.md)

---

## Abstract

Introduce a `@stream` directive on GraphQL subscription fields that enables schema-first declaration of delivery guarantees. When applied, the router automatically wraps subscription responses in an envelope containing a cursor and event ID. Clients resume subscriptions by passing `afterCursor` as a subscription argument. An explicit `acknowledgeEvent` mutation closes the delivery loop. This approach is fully introspectable, works over any transport (WebSocket, SSE), and integrates cleanly with the existing GraphQL client ecosystem via standard variables and mutations.

---

## Motivation

The prior RFCs (001–003) add delivery guarantees at the transport or router layer, invisible in the schema. This creates a discoverability problem: developers cannot tell from the schema alone whether a subscription provides delivery guarantees. Client libraries need out-of-band documentation to know whether to send cursors, session tokens, or use SSE.

This RFC takes a schema-first approach: delivery guarantees are part of the contract between API provider and consumer, visible in introspection, and described by schema documentation. The cursor-based resumption pattern (described in the research document) is a well-understood pattern in GraphQL already (Relay-style pagination cursors).

---

## Scope

**In scope**:
- New `@stream` directive (configurable name) for subscription fields in the event-driven subgraph schema.
- Automatic cursor/envelope injection by the router on decorated subscriptions.
- `afterCursor` argument automatically added to decorated subscription fields.
- `acknowledgeEvent` mutation (optional, for application-level acks).
- Works over `graphql-transport-ws` and SSE transports.
- Compatible with all backend providers (JetStream, Kafka, Redis).

**Out of scope**:
- Exactly-once semantics.
- Non-subscription operations.
- Enforcement of idempotency at the schema level.

---

## Design

### 1. The `@stream` Directive

The directive is added to the Cosmo event-driven subgraph SDL:

```graphql
directive @stream(
  guarantee: DeliveryGuarantee = AT_LEAST_ONCE
  bufferTTL: Int = 300          # seconds; 0 = no buffering
  maxReplay: Int = 10000        # max events to replay on cursor resume
) on FIELD_DEFINITION

enum DeliveryGuarantee {
  AT_MOST_ONCE   # default behavior (no change)
  AT_LEAST_ONCE  # cursor + replay
}
```

Example usage in a subgraph schema:

```graphql
type Subscription {
  employeeUpdates: Employee!
    @edfs__natsSubscribe(subjects: ["employeeUpdates"], providerId: "my-nats")
    @stream(guarantee: AT_LEAST_ONCE, bufferTTL: 600)

  orderCreated: Order!
    @edfs__kafkaSubscribe(topics: ["orders"], providerId: "my-kafka")
    @stream(guarantee: AT_LEAST_ONCE)
}
```

### 2. Automatic Schema Transformation

When the router compiles the federated schema, it detects `@stream(guarantee: AT_LEAST_ONCE)` on subscription fields and performs the following transformations:

#### 2.1 Add `afterCursor` argument

```graphql
# Original
type Subscription {
  employeeUpdates: Employee! @stream(guarantee: AT_LEAST_ONCE)
}

# After transformation
type Subscription {
  employeeUpdates(afterCursor: String): EmployeeStreamEvent!
}
```

The `afterCursor` argument is optional. When absent, delivery starts from "now" (current behavior). When present, delivery starts from the event after the given cursor.

#### 2.2 Wrap response in a stream envelope type

```graphql
type EmployeeStreamEvent {
  cursor: String!       # opaque, encodes broker position
  eventId: String!      # unique event ID (deduplication key)
  deliveredAt: String!  # ISO 8601 timestamp
  sequenceNumber: Int!  # monotonic per-subscription sequence
  data: Employee!       # the original payload
}
```

The envelope is generated automatically per subscription field. The naming follows a configurable convention: `{FieldName}StreamEvent`.

Clients destructure:
```graphql
subscription {
  employeeUpdates(afterCursor: $cursor) {
    cursor
    eventId
    data {
      id
      name
    }
  }
}
```

After each event the client stores `cursor` and passes it as `$cursor` on the next connection.

### 3. Cursor Semantics

The `cursor` value is an opaque, base64url-encoded JSON structure:

```json
{
  "v": 1,
  "provider": "nats-jetstream",
  "stream": "employees",
  "seq": 42,
  "ts": 1746000000000
}
```

For Kafka:
```json
{
  "v": 1,
  "provider": "kafka",
  "topic": "orders",
  "partitionOffsets": {"0": 1042, "1": 337}
}
```

Clients must treat this as opaque. The structure is versioned (`v`) for future evolution.

### 4. The `acknowledgeEvent` Mutation (Optional)

For use cases requiring application-level acknowledgment (e.g., the client must confirm it _processed_ the event, not just received it), an `acknowledgeEvent` mutation is automatically added to the schema when `@stream` is present:

```graphql
type Mutation {
  acknowledgeEvent(
    subscriptionField: String!
    cursor: String!
  ): AcknowledgeEventResult!
}

type AcknowledgeEventResult {
  acknowledged: Boolean!
  error: String
}
```

When called, the router marks events ≤ cursor as acknowledged in the session buffer. This signals to the router that replay up to that point is no longer needed, allowing buffer GC.

This is analogous to NATS JetStream's `msg.Ack()`, but exposed as a GraphQL mutation — making it explicit in the API contract and callable by any GraphQL client with zero additional tooling.

### 5. Router Behavior on `afterCursor`

When a `Subscribe` message arrives with `afterCursor` set, the router:

1. Decodes the cursor.
2. Depending on provider:
   - **JetStream**: creates an ephemeral consumer at `seq + 1`.
   - **Kafka**: seeks the consumer to `offset + 1` per partition.
   - **Session buffer (RFC-003 hybrid)**: looks up the session buffer and replays from the cursor position.
3. Replays buffered events through the full hook pipeline (including `StreamReceiveEventHandler`).
4. Once caught up, transitions to live delivery.
5. Each delivered event is wrapped in the `StreamEvent` envelope with a fresh cursor.

### 6. `eventId` for Client-Side Deduplication

The `eventId` field provides a stable, unique identifier per event that the client can use for deduplication without inspecting the cursor:

- For JetStream: `{stream-name}:{seq}`.
- For Kafka: `{topic}:{partition}:{offset}`.
- For Redis/engine: UUID generated by the router at dispatch time (no replay possible, but deduplication within a session is still useful).

Client deduplication pseudocode:
```js
const seen = new Set();
subscription.subscribe(event => {
  if (seen.has(event.eventId)) return; // duplicate, skip
  seen.add(event.eventId);
  // prune seen set to last N entries to bound memory
  processEvent(event.data);
  setCursor(event.cursor);
});
```

### 7. Client Integration

#### With Apollo Client

```js
import { ApolloClient, InMemoryCache, gql } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';

const client = new ApolloClient({ link: wsLink, cache: new InMemoryCache() });

// Store cursor across reconnects (e.g., localStorage, sessionStorage)
let cursor = localStorage.getItem('employeeUpdates:cursor');

const observable = client.subscribe({
  query: gql`
    subscription EmployeeUpdates($cursor: String) {
      employeeUpdates(afterCursor: $cursor) {
        cursor
        eventId
        data { id name }
      }
    }
  `,
  variables: { cursor },
});

observable.subscribe(({ data }) => {
  const event = data.employeeUpdates;
  localStorage.setItem('employeeUpdates:cursor', event.cursor);
  cursor = event.cursor;
  // process event.data
});
```

On page reload, `cursor` is retrieved from `localStorage` and passed to the subscription. No library changes needed — standard variables.

#### With urql

```js
import { pipe, subscribe } from 'wonka';

const [unsubscribe] = pipe(
  client.subscription(EMPLOYEE_UPDATES_QUERY, { cursor }),
  subscribe(result => {
    const event = result.data.employeeUpdates;
    cursor = event.cursor;
    sessionStorage.setItem('cursor', cursor);
  })
);
```

#### With graphql-ws (direct)

```js
const client = createClient({ url: 'ws://router/graphql' });

client.subscribe(
  { query: EMPLOYEE_UPDATES_QUERY, variables: { cursor } },
  {
    next: (data) => {
      cursor = data.employeeUpdates.cursor;
      // process data.employeeUpdates.data
    },
    error: () => {
      // reconnect with current cursor
      reconnect();
    },
    complete: () => {}
  }
);
```

#### With Relay

Relay's subscription handling is standard `graphql-ws`. The `cursor` field can be stored in the Relay Store as a field on a subscription root object. A custom subscription handler updates the stored cursor after each event.

### 8. Schema Introspection and Documentation

Because `@stream` is a schema directive, its effects are visible via introspection:

```graphql
{
  __schema {
    subscriptionType {
      fields {
        name
        args { name type { name } }
        type { name fields { name type { name } } }
      }
    }
  }
}
```

Returns:
```json
{
  "name": "employeeUpdates",
  "args": [{"name": "afterCursor", "type": {"name": "String"}}],
  "type": {
    "name": "EmployeeStreamEvent",
    "fields": [
      {"name": "cursor", "type": {"name": "String!"}},
      {"name": "eventId", "type": {"name": "String!"}},
      {"name": "data", "type": {"name": "Employee!"}}
    ]
  }
}
```

GraphQL code generators (codegen, Relay compiler) will automatically generate typed cursor handling code.

### 9. Interaction with Cosmo Streams Hooks

The `@stream` transformation occurs at the router layer, _after_ the `StreamReceiveEventHandler` hook pipeline. This means:
- The hook receives raw events as before.
- The envelope wrapping happens after hooks process the events.
- Cursor generation happens after hooks (the hook can filter events; only delivered events get cursors).

If a hook filters out an event, no cursor is generated for it. The next delivered event will have a cursor pointing past the filtered event. This is correct: the cursor encodes "last delivered position", not "last seen position".

### 10. `@stream` on Non-JetStream Subscriptions

For Redis and engine-based subscriptions, `@stream` provides a best-effort delivery improvement:
- The router generates `eventId` (UUID) for each event.
- The cursor encodes a session-scoped sequence number (router-generated, not broker-native).
- The `afterCursor` argument is accepted but triggers session buffer replay (RFC-003 behavior) rather than broker-native replay.
- If no session buffer is configured, `afterCursor` on Redis/engine subscriptions has no effect (events from the outage period are still lost, but the client can detect the gap via `sequenceNumber` discontinuity).

This gives Redis/engine subscriptions partial delivery improvements (deduplication + gap detection) without requiring RFC-003's session buffer.

---

## Failure Modes and Edge Cases

### Missing `afterCursor` on Reconnect

If the client loses its cursor (e.g., clears `localStorage`), it reconnects without `afterCursor` and receives events from "now". No gap detection from the schema layer; the client starts fresh.

### Stale Cursor (Broker Retention Expired)

If the cursor points to a sequence beyond the broker's retention window, the router replays from the earliest available sequence and includes `"x-cosmo-gap": true` in the first event's extensions, alongside the normal envelope. No schema change needed; this is a transport-layer extension.

### Envelope Type Name Collision

If the subgraph schema already defines a type named `EmployeeStreamEvent`, schema composition will fail with a clear error. The directive should accept a `wrapperType` parameter to override the generated name:

```graphql
employeeUpdates: Employee! @stream(guarantee: AT_LEAST_ONCE, wrapperType: "EmployeeEvent")
```

### `acknowledgeEvent` Mutation Conflicts

If the subgraph already has an `acknowledgeEvent` mutation, the router must namespace it: `acknowledgeStreamEvent`. Configuration should allow customizing the mutation name.

### Large Replays and Slow Clients

Replaying thousands of events to a slow client can exhaust router memory and cause back-pressure on the broker consumer. The `maxReplay` directive parameter caps the number of events replayed per reconnect. Events beyond this cap are skipped; `x-cosmo-gap: true` is set.

---

## Backward Compatibility

- The `@stream` directive is opt-in. Existing subscriptions without the directive are unchanged.
- The directive is a Cosmo extension and is stripped from the schema exposed to clients (non-functional types like federation directives are not part of the client-facing SDL).
- The generated `afterCursor` argument and `StreamEvent` wrapper types _are_ client-visible. This is a schema addition, not a breaking change.
- Existing clients that do not pass `afterCursor` receive current behavior.

---

## Tradeoffs

| Factor | Assessment |
|---|---|
| Schema discoverability | Excellent: cursor, eventId, afterCursor all visible via introspection. |
| Client changes required | Moderate: clients must handle the envelope type and store cursors. |
| Code generation | Strong: graphql-codegen generates typed cursor handling automatically. |
| Transport independence | Works over WebSocket and SSE. |
| Provider coverage | All providers (with degraded guarantees for Redis/engine without session buffer). |
| Breaking change | No: opt-in directive; new wrapper types are additive. |
| Envelope verbosity | Every event carries cursor + eventId overhead. For high-frequency subscriptions, this adds payload size. |
| Schema complexity | `StreamEvent` wrapper types are additional schema types. For schemas with many subscriptions, the type count grows. |
| Relay / pagination analogy | Cursor pattern is already familiar from Relay pagination. Reduces conceptual overhead. |
| Mutation-based ack | Explicit and introspectable, but requires an extra round-trip. Not suitable for high-frequency acks. |

---

## Comparison with Other RFCs

| | RFC-001 (WS cursor) | RFC-002 (SSE) | RFC-003 (session buffer) | RFC-004 (schema directive) |
|---|---|---|---|---|
| Schema visibility | No | No | No | Yes |
| Client library support | Extensions field handling | EventSource API | connectionParams | Standard GraphQL variables |
| Transport | WebSocket | SSE | WebSocket | Any |
| Provider coverage | JetStream | JetStream + Kafka | All | All |
| Ack mechanism | None | None | Explicit message or implicit | Mutation (optional) |
| Code generation friendly | Partial | No | No | Yes |
| Introspectable | No | No | No | Yes |
| Duplicate detection | Cursor comparison | SSE id | x-cosmo-seq | eventId field |
| Gap detection | x-cosmo-cursor-gap extension | event: gap SSE event | sequenceNumber discontinuity | x-cosmo-gap extension + sequenceNumber |

---

## Open Questions

1. Should the `@stream` directive be a Cosmo-proprietary directive (similar to `@edfs__natsSubscribe`) or should it be proposed to the broader GraphQL community as a standard extension?
2. Should cursor storage be the client's responsibility entirely (as proposed here), or should the router offer an optional server-side cursor store (session per client identity) as a complement?
3. Should the generated `StreamEvent` types be hidden in the introspection schema (to reduce noise) and only the `data` field be visible, with cursor handled as a special extension? This trades discoverability for cleanliness.
4. Is the `acknowledgeEvent` mutation ergonomic enough, or should acks be handled via a dedicated connection-level framing (mixing RFC-003's approach)?
5. For high-frequency subscriptions (> 100 events/second), the cursor + eventId overhead per event may be significant. Should there be a `@stream(compressed: true)` mode that batches events into a single `Next` message with one cursor for the batch?
6. How should the `sequenceNumber` in the envelope be defined across sessions — should it be global (per stream) or local (per connection)?
