---
title: "Advanced Security and Rate Limiting in Cosmo Router"
author: Jens Neuse
---

## Current Request Pipeline

1. Read request body from client
2. Load persisted operation if necessary
3. Parse operation
4. Block operation type (optional)
5. Normalize operation
6. Validate operation
7. Plan operation execution
8. Execute operation

### Read Request Body from Client

At the global level, it's possible to limit the size of the request body.

### Load Persisted Operation

If the operation was persisted, meaning that the client only sent the SHA256 hash of the operation,
the persisted operation content is loaded from the storage, e.g. S3.

### Parse Operation

Parsing the operation means to convert the operation string into an AST.
At this stage, we also detect the operation type and name.
If the operation name is not matching the operation name in the JSON payload, the operation will be rejected.

### Block Operation Type

Once the operation is parsed, it's possible to block certain operation types.
Queries must always be allowed, otherwise GraphQL cannot work.
Mutations and Subscriptions can be blocked.

### Normalize Operation

Normalizing the operation means to clean up and optimize the AST without changing the semantics.
This step also includes the removal of unnecessary fields and arguments,
e.g. when using directives like `@skip` or `@include`,
which allow us to reduce the size and complexity of the operation.

Normalization has two goals:
1. Make the operation easier to understand for subsequent steps, like validation and planning. If we can rely on normalization to inline fragments, etc., validation and planning implementations can be much simpler.
2. Improve the performance and reduce the cost of validating and planning an operation. Smaller operations are faster to validate and plan.

Normalization has a cost by itself, but we're caching the normalized operation to avoid re-normalizing the same operation multiple times.

### Validate Operation

Validation is the process of ensuring that the operation is semantically correct.
In addition, we need to validate the operation against the client Schema and ensure that the variables are valid and have the correct types.
Validation also has a cache, so we don't need to validate the same operation multiple times.

We've explicitly mentioned client schema validation because each supergraph has two schemas.
The internal supergraph schema, aware of all entities and also inaccessible fields,
and the client schema, which reflects the schema that the client is aware of.
Even though we might be using an inaccessible field internally, e.g. as a key,
clients are not allowed to query this field, which can be guaranteed by omitting it from the client schema.

### Plan Operation Execution

Planning is the process of determining which services need to be queried to fulfill the operation,
and how the results need to be merged.

As a result of the planning process, we generate a sequence of subgraph fetches.
Such a sequence and include parallel and sequential steps,
as well as steps that depend on the results of previous steps.
Internally, we're building a fetch dependency tree that is used to generate the most optimal fetch sequence,
parallelizing as much as possible and avoiding unnecessary fetches.

### Execute Operation

During the execution phase, we're executing the fetch sequence generated during the planning phase.
After each step, we're merging the results into a JSON AST.
This JSON AST is then used as input for subsequent steps.
Once all steps are executed, we traverse the response shape AST generated during the planning phase and populate the response from the JSON AST.
This is also possible with partial results, e.g. when some fetches fail.
In such a case, we'll render partial results and include errors in the response.

Summarizing, the execution phase is split into two parts:
1. Fetching data from the services
2. Building the response

## Advanced Security

Now that we've covered the basic request pipeline, let's discuss where, when and how we can apply advanced security measures,
like security policies, blocking mechanisms, rate limiting, and more.

In general, security measures can be grouped into three categories:

1. **Client Request** - Measures that are applied to the "original" request from the client
2. **Normalized Operation** - Measures that are applied to the normalized operation
3. **Execution** - Measures that are applied during the execution phase

### Client Request

If we want to apply security measures to the original request from the client,
we have to do so before the operation is normalized.
During normalization, we might lose some information that could be relevant for security measures.

For example, we might want to limit the number of root fields, or root fields with aliases in a query.
After normalization, it's possible that the AST has been transformed, e.g. by merging fields or selection sets.
This means that the same security measure would have different effects depending on when it's applied.

At the same time, we have to be careful in how we're using the AST before normalization and validation,
as we must not trust the AST to be valid or secure.

That being said, we can still apply many security measures at this stage, like limiting the depth of an operation
or limiting the total number of fields.

### Normalized Operation

Once the operation is normalized, some security measures can be applied more easily.
During normalization, we inline fragments and merge selection sets.
As a result, it's very much straight forward to measure the depth of an operation or the number of fields without having to deal with duplicate fields or fragments.

The downside of using the normalized AST is that we've lost some context information in regards to the original operation.
For example, we might be able to measure the total depth of the operation,
but it might be hard to exactly tell the client which part of the original operation caused the depth to exceed the limit.

### Execution

In comparison to the previous two stages, the execution phase is the most accurate stage to apply security measures.
Instead of looking at the GraphQL Operation AST and trying to infer the complexity of the operation,
we're able to look at the actual fetch sequence and the results of each fetch.

While we might know during the normalization phase that a field returns a list of entities,
and this list might be very large and cause more complex subsequent fetches depending on the list size,
we can't be sure about the actual size of the list until we execute the fetch.
At the execution phase, we know exactly how many entities are returned and can apply security measures accordingly.

While that's the upside of applying security measures during the execution phase,
there's also a downside.
The more granular we want to be in terms of applying security measures,
the more expensive it gets.

If we check the request operation AST statically, that adds a little overhead.
If we call an external service to determine the security policy, that adds additional latency per operation.
However, if we call an external rate limiting service for every request we're executing at the router level,
the latency overhead increases by the number of fetches we're executing times the latency of the rate limiting service.

As a result, we have to find a balance between the granularity of the security measures and the overhead they cause.

## Solutions

Now that we've discussed the different stages where we can apply security measures,
let's talk about some possible solutions and their trade-offs.

### Static AST Level Security Policies

Once the Operation is normalized, we can measure the complexity of the operation statically.
We can calculate the following metrics:
- Depth of the operation (number of nested fields)
- Total number of fields in the operation
- Number of root fields
- Number of root fields with aliases

A possible strategy could be to have a global policy at the Router level that applies to all requests.
E.g. you could configure to block all operations with a depth greater than 7.

This approach is very simple to configure, it's very fast to execute and it's very predictable.
However, it's also possible that this approach blocks false positives.
This approach also doesn't distinguish between different clients or different operations.

### Dynamic AST Level Security Policies

Instead of having one global policy for all requests, we could also have a contract with another service that provides security policies.
Based on the user agent, the client IP, or other information like a Header or a JWT token,
the service could return the policy for the current request.

This approach is more flexible than the static approach, as it allows us to have different policies for different clients.
It also allows us to dynamically change the policy based on the client's behavior,
but this would mainly be a concern of the security policy service.

The downside of this approach is that it adds at least one additional network call per request.

### Dynamic AST Level Security Policies with Shared State

What both of the above approaches have in common is that they're stateless.
They don't take into account the history of the client's requests.

We could extend both approaches by adding a shared state between the Router instances.
This would allow us to implement security policies like for example rate limiting per client or per operation.

A policy with this approach could read as follows:

1. Operations with a depth greater than 7 are always blocked
2. Clients identified by the sub claim of their JWT token are allowed to execute up to 100 operations per minute
3. Clients identified by the sub claim of their JWT token are allowed to request up to 1000 fields per minute

As a storage for the shared state, we could use a distributed key-value store like Redis.

This approach is more complex than the previous ones, as we have to deploy and maintain a service for the shared state,
which all Routers have to connect to.

An alternative to using a Key-Value store would be to use the Policy Service as the shared state.
The Router could tell the Policy Service about the client request, the number of fields, the depth, etc.
and the Policy Service could then decide if the request is allowed or not.
This would move the responsibility of the shared state to the Policy Service and keep the Router setup less complex.

### Execution Level Security Policies

In addition to AST level security policies, we could also apply security policies during the execution phase.

For example, we can define a policy that limits the total number of requests a client can make per minute.
Such a policy can be very broad but also very granular, depending on your requirements.
It's possible that the policy server returns a global policy, e.g. 1000 requests per minute,
or it could provide a more granular policy, e.g. 100 requests per minute on subgraph A and 200 requests per minute on subgraph B.

For this to work, we need to have a shared state between the Router instances, similar to the example above.

What this approach doesn't take into account is the complexity of the operation.
We might not know exactly how complex each operation is, but we might be able to narrow it down,
e.g. by measuring the latency of each fetch and using this as a proxy for the complexity of the operation.

By doing so, we could implement a policy that limits a client to 500ms of execution time per minute,
counting latency from the Router to each subgraph.

Another approach could be to count the number of entities returned by each fetch.
This would allow us to implement a policy that limits a client to 1000 resolved entities per minute.

When implementing execution level security policies, it needs to be decided if the policy should be applied before each fetch or before all fetches.
If we apply the policy before each fetch, we are more precise, but we also need to call the shared state (e.g. Redis) before each fetch,
which adds overhead.

We can also apply the policy before all fetches, which is less precise but also less overhead.
Problems that might arise from this approach are that we might have fetches whose execution depends on the results of previous fetches.
As a result, we might execute less fetches than we asked the shared state for, so we might have to call the shared state again to correct our estimation.
On the other hand, we might also execute more fetches than we estimated, e.g. because a previous fetch returned more data than we expected.

## Transparency in terms of returned errors for "friendly" clients

When applying security measures, it's important to provide feedback to the client.
We should always assume that a client is unfriendly and tries to exploit the system.
However, we should also be able to communicate meaningful errors to friendly clients that simply made a mistake or hit a limit.

What's important is that we're able to communicate to a friendly client why their request was blocked and how they can fix their mistake in a meaningful way.
By that, I meant that our client should be able to understand how they exceeded a limit.
E.g. if we say that a client "exceeded the maximum number of entities requested per minute",
but our client doesn't know what an entity is, this error message is not helpful.

Similarly, if we're using a very complicated algorithm to determine the complexity of an operation,
it might be impossible for a client to estimate how complex their operation is.

One property of a Federated GraphQL architecture is that clients are not aware of the underlying services.
For them, the Router exposes a GraphQL API. They don't know about the subgraphs and they might not know about entities.
If we limit them to 1000 subgraph calls per minute, they might not know what a subgraph call is.
They also lack the understanding of how many subgraph calls their operation will result in.
We might expose to them an interface to understand the correlation between their Query and the number of subgraph calls it results in.
However, this contradicts the idea of hiding the underlying services from the client.

A better approach might be to limit the client to 500ms of execution time per minute.
This is a more generic approach that doesn't require us to expose the underlying services to the client.

That being said, limiting a client to compute time has another downside.
It's hard for the client to estimate how much time their operation will take.
Just by writing a Query, you would never know how long it will take the Router to execute it.

## The trade-offs of different approaches

As you can see, there's no one-size-fits-all solution.
We have to balance different trade-offs, like complexity, overhead, precision, and transparency.

In general, the more complex the security measures are, the more overhead they cause.
We can go very granular with our security measures, but this might make it harder to understand for the client why their request was blocked.

## Conclusion

When implementing security measures, we have to find a balance between complexity, overhead, precision, and transparency.
We have to decide at which stage we want to apply the security measures and how granular we want to be.

In general, it's a good idea to start with simple security measures and only add complexity if necessary.
It's also a good idea to monitor the system and see if the security measures are effective and if they cause any problems.

If we're not sure about the effectiveness of a security measure, we should consider adding monitoring to see how many requests are blocked and why they are blocked.
This can help us to understand if the security measure is too strict or too lenient.