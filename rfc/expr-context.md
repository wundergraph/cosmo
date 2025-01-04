---
title: "Expression Context: Allowing Expressions to Access Request and Response Information"
author: Jens Neuse, Dustin Deus
---

# Expression Context

This RFC proposes a new feature to provide a read-only context object to an expr-lang VM that can be used to access information about the request, response, and other relevant information. The context object is available at all times during the request's lifecycle but not all fields are available at all times. One example is authentication information, which is only available after the request has been authenticated.

## Motivation

The motivation for this feature is to provide a flexible way to create conditions but also to access information about the request, response, and other relevant information in expressions. This can be useful for a variety of use cases, such as:

- Define dynamic routing rules based on the request or response information e.g. block mutations when a specific header is set.
- Extract a value from the request to use it as a prefix for the cache key.
- Access the authentication information to make authorization decisions.
- Foundation for Event Driven Field Subscriptions (EDFS) to access the field information in a consistent way.

# Naming Convention

- Fields are named using camelCase (e.g. request.auth.claims)
- Methods are named using PascalCase (e.g. request.header.Get("Content-Type"))
- Methods should be exported through an interface to make the contract clear

# Principles

- The Expr package is only used to evaluate expressions in the context of the request / response or router.
- The user should never be able to mutate the context or any other application state.
- The fields of the context are always initialized and never a pointer.

# Context Object

## request

The client request object is a read-only object that provides information about the incoming request. It is available at all times during the request's lifecycle.

```
request.id
request.header
request.method
request.body.query
request.body.operationName
request.body.variables
request.body.extensions
request.url.host
request.url.path
request.url.port

request.client.name
request.client.version
request.client.ip
```

## request.context

The context object provides information about the context of the request. A generic object that can be used to store any information that is relevant to the request.

```
request.context.agent
```

## Expression templates

In the Router config, you can define templates. This can be useful to provide a more readable way to access repeated expressions. Templates can be references everywhere where expressions are used.

```yaml
expressions:
  agent: "request.auth.claims.sub || request.client.ip || request.header.X-Forwarded-For"
```

Usage:

```yaml
condition: templates.agent == "Foo"
```

## authentication

The authentication object provides information about the authentication of the request.

```
request.auth
request.auth.isAuthenticated
request.auth.type
request.auth.claims
request.auth.scopes
```

## request.operation

The operation object provides information about the operation being executed. This information is parsed and validated by the router.

```
request.operation.name // e.g. MyQuery
request.operation.type // query, mutation, subscription
request.operation.hash // hash of the operation
```

## subgraph.*

The subgraph object provides information about the current fetch operation being executed by the router,
typically used to fetch data from a subgraph via a federated GraphQL Request.

```
subgraph.request.header
subgraph.request.method // GET, POST, PUT, DELETE 
subgraph.request.body.query // GraphQL query
subgraph.request.body.operation_name // GraphQL operation name
subgraph.request.body.variables // GraphQL variables
subgraph.request.body.extensions // GraphQL extensions
subgraph.request.url.host // subgraph host
subgraph.request.url.path // e.g. /graphql
subgraph.request.url.port // e.g. 443

subgraph.name // name of the subgraph being fetched from
subgraph.id // id of the subgraph being fetched from

subgraph.response.status
subgraph.response.header
subgraph.response.body.errors
subgraph.response.body.data
subgraph.response.body.extensions
```

## response

The response object provides read only information about the response that will be sent to the client.

```
response.status // HTTP status code
response.header // HTTP headers
response.body // HTTP body
```

## router

The router object provides information about the router.

```
router.config.version
```

# EDFS

## field.*

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