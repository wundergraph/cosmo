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
unsetContext("request.context.agent")
```

```
# set agent to request.auth.claims.sub
setContext("agent", request.auth.claims.sub)
```

```
# add another field to the context object
setContext("client", request.client.name)
```

# authentication

The authentication object provides information about the authentication of the request.

```
request.auth
request.auth.isAuthenticated
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
subgraph.request.header
subgraph.request.method // GET, POST, PUT, DELETE 
subgraph.request.body.query // GraphQL query
subgraph.request.body.operation_name // GraphQL operation name
subgraph.request.body.variables // GraphQL variables
subgraph.request.body.extensions // GraphQL extensions
subgraph.request.uri.host // subgraph host
subgraph.request.uri.path // e.g. /graphql
subgraph.request.uri.port // e.g. 443

subgraph.name // name of the subgraph being fetched from
subgraph.id // id of the subgraph being fetched from

subgraph.response.status
subgraph.response.header
subgraph.response.body.errors
subgraph.response.body.data
subgraph.response.body.extensions
```

# response

The response object provides read only information about the response that will be sent to the client.

```
response.status // HTTP status code
response.header // HTTP headers
response.body // HTTP body
```

# field.*

The field object provides information about the field being resolved.
This is useful, e.g. in the case of defining an Event Driven Subgraph. 

```graphql
type Subscription {
    employeeUpdated(employeeID: ID!): Employee! @edfs__natsSubscribe(subjectsExpr: "'employee.updated.' + field.args.employeeID")
    employeeUpdatedFromClaim: Employee! @edfs__natsSubscribe(subjectsExpr: "'employee.updated.' + request.auth.claims.sub")
}
```

```
field.name // name of the field, e.g. employeeUpdated
field.args // arguments of the field, e.g. { employeeID: "123" }
field.type // type of the field, e.g. Employee
field.parentType // parent type of the field, e.g. Subscription
field.path // path of the field, e.g. employeeUpdated
```

# router

The router object provides information about the router.

```
router.config.version
```