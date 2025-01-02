# Expression Context

Cosmo Router provides a context object to an expr-lang VM that can be used to access information about the request, response, and other relevant information. The context object is available at all times during the request's lifecycle.

## request

The client request object is a read-only object that provides information about the incoming request. It is available at all times during the request's lifecycle.

```
request.id
request.header
request.method
request.body.query
request.body.operation_name
request.body.variables
request.body.extensions
request.uri.host
request.uri.path
request.uri.port

request.client.name
request.client.version
request.client.ip
request.routerConfigVersion
```

# request.context

The context object provides information about the context of the request. A generic object that can be used to store any information that is relevant to the request.

```
request.context.agent
```

In the Router config, you can use the following expression to set a custom field in the context object:

```yaml
context:
  agent: "request.auth.claims.sub || request.client.ip || request.header.X-Forwarded-For"
```

At runtime, the following expression can be used to set additional fields in the context object or to override or unset existing fields:

```
# set agent to undefined
unset("request.context.agent")
```

```
# set agent to request.auth.claims.sub
set("request.context.agent", request.auth.claims.sub)
```

```
# add another field to the context object
set("request.context.client", request.client.name)
```

# authentication

The authentication object provides information about the authentication of the request.

```
request.isAuthenticated // true or false
request.auth // Only set when authenticated
request.auth.type
request.auth.claims
request.auth.scopes
```

# request.operation

The operation object provides information about the operation being executed. This information is parsed and validated by the router.

```
request.operation.name // e.g. MyQuery
request.operation.type // query, mutation, subscription
request.operation.hash // hash of the operation
```

# fetch.*

The fetch object provides information about a fetch operation being executed by the router,
typically used to fetch data from a subgraph via a federated GraphQL Request.

```
fetch.request.header
fetch.request.method // GET, POST, PUT, DELETE 
fetch.request.body.query // GraphQL query
fetch.request.body.operation_name // GraphQL operation name
fetch.request.body.variables // GraphQL variables
fetch.request.body.extensions // GraphQL extensions
fetch.request.uri.host // subgraph host
fetch.request.uri.path // e.g. /graphql
fetch.request.uri.port // e.g. 443

fetch.subgraph.name // name of the subgraph being fetched from
fetch.subgraph.id // id of the subgraph being fetched from

fetch.response.status
fetch.response.header
fetch.response.body.errors
fetch.response.body.data
fetch.response.body.extensions
```