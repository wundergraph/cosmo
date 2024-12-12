---
title: "Router Custom Module System v1"
author: Dustin Deus
date: 2024-08-11
status: Draft
---

# Router Custom Module System v1

- **Author:** Dustin Deus
- **Date:** 2024-08-11
- **Status:** Draft

## Abstract

This RFC describes an overhaul of the current module system in the router. The new module system is designed to be more flexible and native to GraphQL. It allows developers to hook into the router lifecycle as well as outgoing and incoming requests to subgraphs.

## Introduction

As of today, customers can extend the router with custom modules. These modules can be used to change the behavior of the router, add custom logic, or integrate with other systems. The current module system has several limitations that we want to address with this RFC:

- The current module system is not native to GraphQL. It is based on HTTP middleware and does not provide a GraphQL-specific API.
- The current module system is inconsistent and hard to use. It does not provide a clear API for developers to intercept and modify GraphQL requests and responses.
- The current module system does not provide an intuitive way to create or modify OpenTelemetry data, logs for different parts of the router lifecycle.
- The current module system does not provide a way to share state between hooks or modules in a safe and efficient way.
- The current module system does not provide a way to interact with the parsed, normalized, and planned GraphQL operation in order to implement custom logic.
- The current module system does not provide a way to hook into authorization and authentication logic in the router.
- The current module system does not provide a way to hook into the usage of GraphQL directives in the operation definition or subgraph schema.
- The current module system does not provide a way to hook into GraphQL scalar types for validation, transformation, or custom handling.
- The current module system does not provide a way to hook into lifecycle when a GraphQL server starts, stops, or when the schema is updated.


Ultimately, custom modules must be self-contained, composable and testable. They should provide a clear API for developers to interact with the router and subgraph lifecycle and implement custom logic without having to understand the internal workings of the router or advanced Go programming concepts.
To briefly explain the decision to use Go as the language for the module system, we have chosen Go because it is a simple and easy-to-learn language that is widely used in the infrastructure and cloud-native ecosystem. You can build custom integration on top production-grade SDK of AWS, GCP and the community without re-implementing them from scratch. It superiors to scripting languages like Rhai or cross-compiling WebAssembly because it can be easily debugged, profiled, and tested with any modern IDE (VsCode, Goland, etc.). Not part of this RFC, are our ambitions to make the workflow as smooth as possible with a CLI tool that can scaffold, test, and deploy custom modules. In the future, custom modules could be published to a central registry and shared with the community. A brief overview of the workflow is provided at the end of this RFC.

As powerful as the new module becomes, it is important to move basic and common functionality into the core of the router because building and maintaining custom modules should be a last resort. The router should provide a rich set of features out of the box that cover the most common use cases. Custom modules should be reserved for advanced or highly specific use cases that cannot be achieved with the built-in features of the router. Integration with third-party services, custom authentication, and advanced telemetry are examples of use cases that are well-suited for custom modules.

## Proposal

A developer can implement a custom module by creating a struct that implements one or more of the following interfaces:

- RouterHooks: Provides hooks for the router lifecycle, including request and response handling.
  - `RouterRequestHook`: Called when a request is made to the router and after all GraphQL information is available.
  - `RouterResponseHook`: Called before the response is sent to the client.
  - `RouterErrorHook`: Called when an error occurs during the router lifecycle.
- SubgraphHooks: Provides hooks for subgraph requests and responses.
  - `SubgraphRequestHook`: Called when a subgraph request is made.
  - `SubgraphResponseHook`: Called when a subgraph response is received.
- ApplicationHooks: Provides hooks for the application lifecycle, including startup, shutdown, and error handling.
  - `ApplicationStartHook`: Called when the application starts.
  - `ApplicationStopHook`: Called when the application stops.
  - `ApplicationErrorHook`: Called when an error occurs during the application lifecycle.
- AuthenticationHooks: Provides hooks for authentication and authorization logic.
  - `AuthenticationHook`: Called when a router request is authenticated.
- AuthorizationHooks: Provides hooks for authorization logic.
  - `AuthorizationHook`: Called when a router request is authorized.
- TelemetryHooks: Provides hooks for OpenTelemetry tracing and metrics.
  - `TelemetrySpanHook`: Called when a span is created.
  - `TelemetryMetricHook`: Called when a metric is recorded.
- GraphServerHooks: Provides hooks for the lifecycle of a GraphQL server.
  - `GraphServerStartHook`: Called when the GraphQL server starts e.g. for the first time or when the schema is updated.
  - `GraphServerStopHook`: Called when the GraphQL server stops e.g. when the application is shut down or the old schema is replaced.
- GraphQLOperationHooks: Provides hooks for parsed, normalized, and planned GraphQL operations.
  - `GraphQLOperationParseHook`: Called when an operation is parsed.
  - `GraphQLOperationNormalizeHook`: Called when an operation is normalized.
  - `GraphQLOperationPlanHook`: Called when an operation is planned.
- `ModuleHooks` (**Required**): Provides hooks for the module lifecycle, including provisioning and shutdown.
  - `Provision`: Called when the module is provisioned.
  - `Shutdown`: Called when the module is shutdown.
  - `Module`: Returns the module information and factory function.

For some hooks, we will also provide `pre/post` hooks. This allows developers to perform additional logic after the main hook has been executed e.g. to annotate a span with additional attributes or events.

```go
type MyModule struct{}

type Subgraph struct {
	// The name of the subgraph
	Name string
	// The ID of the subgraph
	ID string
	// The URL of the subgraph
	URL *url.URL
	// The schema of the subgraph
	Schema *graphql.Schema
}

type Federatedgraph struct {
	// The name of the graph
	Name string
	// The ID of the graph
	ID string
	// Version of the graph
	Version string
	// Subgraphs of the graph
	Subgraphs []*core.Subgraph
	// GraphQL schema of the graph
	Schema *graphql.Schema
}

type Operation struct {
	// The name of the operation
	Name string
	// The type of the operation (query, mutation, subscription)
	Type string
	// The document representation of the operation
	Document graphql.Document
	// The variables of the operation
	Variables map[string]interface{}
	// The client name of the operation
	ClientName string
	// The client version of the operation
	ClientVersion string
	// The uploaded files of the operation
	UploadedFiles map[string]*core.UploadedFile
	// The plan of the operation
	Plan *core.Plan
	// The normalization of the operation
	Normalization *core.Normalization
}

type RouterRequest struct {
	// The original GraphQL request with all the information like query, variables, operation name, extensions etc.
	Request *core.GraphQLRequest
	// The parsed, normaliazed and planned operation with all the information like name, variables, type, document representation,
	// client name version, uploaded files, plan, normalization, persisted operation etc.
	Operation *core.Operation
	// The active Telemetry instance
	Telemetry *core.Telemetry
	// The active graph
    Federatedgraph *core.Federatedgraph
	// The original HTTP request
	HttpRequest *http.Request
	// Logger for the router request
	Logger *zap.Logger
}

type RouterResponse struct {
	// The original RouterRequest
	Request *core.RouterRequest
	// The active Telemetry instance
	Telemetry *core.Telemetry
	// The final GraphQL response with all the information like data, errors, extensions etc.
	// This is the response that will be sent to the client and can be manipulated or replaced
	Response *core.GraphQLResponse
	// The original HTTP response
	HttpResponse *http.Response
}

type SubgraphRequest struct {
	// The active subgraph
	Subgraph *core.Subgraph
	// The original Router request
	RouterRequest *core.RouterRequest
	// The final GraphQL request to the subgraph
	Request *core.GraphQLRequest
	// The active Telemetry instance
	Telemetry *core.Telemetry
	// The original http request to the subgraph
	HttpRequest *http.Request
	// Logger for the subgraph request
	Logger *zap.Logger
}

type SubgraphResponse struct {
	// The active subgraph
	Subgraph *core.Subgraph
	// The original Router request
	RouterRequest *core.RouterRequest
	// The active Telemetry instance
	Telemetry *core.Telemetry
	// The final GraphQL response from the subgraph
	Response *core.GraphQLResponse
	// The original http response from the subgraph
	HttpResponse *http.Response
}

// Router Hooks

type RouterRequestHook interface {
	// OnRouterRequest is called when a request is made to the router and after all GraphQL information is available
	// Returning an error will result in a GraphQL error being returned to the client.
	OnRouterRequest(ctx *core.RouterRequest, err error) error
}

type RouterResponseHook interface {
	// OnRouterResponse is called before the response is sent to the client
	// Returning an error will result in a GraphQL error being returned to the client.
	OnRouterResponse(ctx *core.RouterResponse, err error) error
}

type RouterErrorHook interface {
	// OnError is called when an error occurs during the router lifecycle
	OnRouterError(err error)
}

// SubgraphHooks are called when a subgraph request or response is made.
// The order is not guaranteed, so the hooks should be idempotent and side-effect free.
// if state needs to be shared between hooks, it should be stored in the context.
// We will provide an easy way to share state between hooks.

type SubgraphRequestHook interface {
	// OnSubgraphRequest is called when a subgraph request is made
	// Returning an error will result in a GraphQL error being returned to the client.
	OnSubgraphRequest(ctx *core.SubgraphRequest, err error) error
}

type SubgraphResponseHook interface {
	// OnSubgraphResponse is called when a subgraph response is received
	// Returning an error will result in a GraphQL error being returned to the client.
	OnSubgraphResponse(ctx *core.SubgraphResponse, err error) error
}

type SubgraphErrorHook interface {
	// OnError is called when an error occurs during the subgraph lifecycle
	OnSubgraphError(err error)
}

// ApplicationHooks are called when the application starts, stops, or an error occurs.

type ApplicationStartHook interface {
	// OnAppStart is called when the application starts
	// Returning an error will result in the application not starting
	OnAppStart() error
}

type ApplicationStopHook interface {
	// OnAppStop is called when the application stops
	// Returning an error will result in the application not stopping
	OnAppStop() error
}

type ApplicationErrorHook interface {
	// OnError is called when an error occurs during the application lifecycle start/stop or any other error
	OnAppError(err error)
}

// TelemetryHooks are called when a span is created

type TelemetrySpanHook interface {
	// OnSpan is called when a span is created
	// Returning a function to be called when the span ends.
	// This can be used to add custom attributes or events to the span.
	OnSpan(span *trace.Span) func() // Return a function to be called when the span ends
}

type TelemetryMetricHook interface {
	// OnMetric is called when a metric is recorded
	// Returning an error will result in a telemetry error
	OnMetric(metric *metric.Metric) error
}

// AuthenticationHooks are called when a router request is authenticated

type AuthenticationHook interface {
	// OnAuthenticate is called when a router request is authenticated
	// Returning an error will result in a GraphQL error as a response from the router.
	OnAuthenticate(ctx *core.RouterRequest, err error) error
}

// AuthorizationHooks are called when a router request is authorized

type AuthorizationHook interface {
	// OnAuthorize is called when a router request is authorized
	// Returning an error will result in a GraphQL error as a response from the router.
	OnAuthorize(ctx *core.RouterRequest, err error) error
}

// OperationHooks are called when an operation is parsed, normalized, or planned

type GraphQLOperationParseHook interface {
	// OnOperationParse is called when an operation is parsed
	// Returning an error will result in a GraphQL error as a response from the router.
	OnOperationParse(op *core.Operation, err error) error
}

type GraphQLOperationNormalizeHook interface {
	// OnNormalize is called when an operation is normalized
	// Returning an error will result in a GraphQL error as a response from the router.
	OnOperationNormalize(op *core.Operation, err error) error
}

type GraphQLOperationPlanHook interface {
	// OnPlan is called when an operation is planned
	// Returning an error will result in a GraphQL error as a response from the router.
	OnOperationPlan(op *core.Operation, err error) error
}

// Module Hooks

type ModuleHooks interface {
	// Provision is called when the module is provisioned
	Provision(ctx *core.ModuleContext) error
	// Shutdown is called when the module is shutdown
	Shutdown() error
	// Module returns the module information and factory function
	Module() core.ModuleInfo
}

// GraphServerHooks are called when the GraphQL server starts, stops, or the schema is updated

type GraphServerStartHook interface {
    // OnGraphServerStart is called when the GraphQL server starts
    // Returning an error will result in the GraphQL server not starting
    OnGraphServerStart(ctx *core.GraphServerContext) error
}

type GraphServerStopHook interface {
    // OnGraphServerStop is called when the GraphQL server stops
    // Returning an error will result in the GraphQL server not stopping
    OnGraphServerStop(ctx *core.GraphServerContext) error
}
```

## Example Use Cases

- **Advanced GraphQL Operation Handling**: A module that walks the parsed operation and performs custom logic based on the operation type, fields, and arguments.
- **Request validation**: A module that validates incoming requests and returns an error if the request is invalid.
- **Custom Telemetry**: A module that creates custom spans or metric data and sends it to a telemetry backend.
- **Custom Authentication / Authorization**: A module that authenticates incoming requests and adds user information to the subgraph requests.
- **Response interception**: A module that intercepts responses from subgraphs and modifies them before they are sent to the client.
- **Response Caching**: A module that caches responses from subgraphs and returns them for identical requests.
- **GraphQL Directive Handling**: A module that reacts to specific GraphQL directives in the operation definition.
- **GraphQL Scalar Handling**: A module that allows custom handling of scalar types in the operation e.g. validation, transformation.
- **Enriching Logs**: A module that adds custom log fields to the router and subgraph logs.

## Backwards Compatibility

The new module system is not backwards compatible with the old module system. Existing custom modules will need to be rewritten to use the new interfaces and API. We will provide a migration guide and tooling to help developers migrate their custom modules to the new system.

# Example Modules

__All examples are pseudocode and not tested, but they are as close as possible to the final implementation__

## Custom Telemetry

This module adds custom attributes to the OpenTelemetry span for each router request. Data can come from the request, the router configuration, or external sources. The example modifies the first span of the router but depending on the hook, the span is different.

```go
type MyModule struct{}

// Ensure that MyModule implements the RouterRequestHook interface
var _ RouterRequestHook = (*MyModule)(nil)

func (m *MyModule) OnRouterRequest(req *core.RouterRequest, err error) error {
	req.Telemetry.Span.AddEvent("Router Request")
	req.Telemetry.Span.AddAttributes(
		attribute.String("customer.id", "123"),
	)
	return nil
}
```

## Intercepting Router Responses

This module intercepts the final Router response to rewrite errors and add custom extensions. You have access to the parsed operation, the router request, and the router response.

```go
type MyModule struct{}

// Ensure that MyModule implements the RouterResponseHook interface
var _ RouterResponseHook = (*MyModule)(nil)

func (m *MyModule) OnRouterResponse(res *core.RouterResponse, err error) error {
	// Add custom extensions to the response
	res.Response.Extensions["myExtension"] = "myValue"

	// Rewrite errors in the response
	if len(res.Response.Errors) > 0 {
		for _, err := range res.Response.Errors {
			err.Message = "An error occurred"
		}
	}

	return nil
}
```

## Enriching logs

This module adds custom log fields to the router and subgraph logs. Data can come from the request, the response, or external sources. This will affect request and response logs.

```go
type MyModule struct{}

// Ensure that MyModule implements the RouterRequestHook interface
var _ RouterRequestHook = (*MyModule)(nil)

func (m *MyModule) OnRouterRequest(req *core.RouterRequest, err error) error {
    // Add custom fields to the router log
    req.Logger = req.Logger.With(zap.String("myField", "myValue"))
    
    return nil
}
```

## Custom service integration

This module integrates with Redis to cache responses from subgraphs. Useful for very specific use cases where caching is required.

```go
type MyModule struct{
	Redis *redis.Client
}

// Ensure that MyModule implements the SubgraphHooks interface
var _ SubgraphRequestHook = (*MyModule)(nil)
var _ SubgraphResponseHook = (*MyModule)(nil)

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
    // Initialize the Redis client
    client := redis.NewClient(&redis.Options{
        Addr: "localhost:6379",
    })
    m.Redis = client
    return nil
}

func (m *MyModule) OnSubgraphRequest(req *core.SubgraphRequest, err error) error {
    // Check if the response is cached in Redis
    key := req.Request.Operation.Hash
    data, err := m.Redis.Get(key).Bytes()
    if err == nil {
        var response core.GraphQLResponse
        err := json.Unmarshal(data, &response)
        if err == nil {
            // Return the cached response
            req.Response = &response
            return nil
        }
    }
    return nil
}

func (m *MyModule) OnSubgraphResponse(res *core.SubgraphResponse, err error) error {
    // Cache the response in Redis
    key := res.Request.Operation.Hash
    data, err := json.Marshal(res.Response)
    if err != nil {
        return err
    }
    m.Redis.Set(key, data, 24*time.Hour)
    return nil
}

func (m *MyModule) Cleanup() error {
    // Close the Redis client
    return m.Redis.Close()
}
```

## Custom Module configuration

Custom modules can be configured using a YAML file that is loaded by the router at startup `config.yaml`. We reserve a section in the configuration file for custom modules. Each module can have its own configuration section with custom properties.
The name of the module in the configuration file must match the name specified in the `ModuleInfo` struct.

```yaml
# config.yaml
modules:
  my_module:
    value: 42
```

At module provisioning, the configuration is loaded and is marshaled into the module struct, where it can be accessed across the module lifecycle. We support all primitive types, slices, and maps in the configuration file.

```go
type MyModule struct {
	Value uint64 `yaml:"value"`

	Nested struct {
		Property string `yaml:"property"`
	} `yaml:"nested"`
}

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	// Access the custom value from the configuration
	m.Value
}

func (m *MyModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		Name: "myModule",
		New:  func() core.Module { return &MyModule{} },
	}
}
```

## Custom Authentication and Authorization

Custom modules can be used to implement custom authentication and authorization logic in the router. The module can intercept incoming requests and validate the user's credentials, scopes, and permissions before forwarding the request to the subgraph. The router has built-in support for JWK. The parsed token information is available in the request `req.Request.Auth` field.

```go
type MyModule struct{}

var _ AuthenticationHook = (*MyModule)(nil)

func (m *MyModule) OnAuthenticate(req *core.RouterRequest, err error) error {
	// Authenticate the user's credentials
	if !authenticateUser(req.HttpRequest) {
		return core.UnauthenticatedError("Unauthenticated")
	}
	return nil
}

func (m *MyModule) OnAuthenticate(req *core.RouterRequest, err error) error {
  if !authorizeUser(req.Request.Auth) {
    return core.UnauthenticatedError("Unauthorized")
  }
  return nil
}
```

# Advanced Modules

## Custom Subgraph Transport

Overwrite the subgraph transport to use a custom HTTP client with retries, mTLS, timeouts, and circuit breaking.

```go
type MyModule struct {
	Client *http.Client
}

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	// Register your custom HTTP client as the transport for subgraph requests
	// Can only be done in the provision method. If a second module tries to register a transport,
	// an error is returned because the behavior is undefined.
	
	ctx.RegisterOriginTransport(&http.Transport{})
	return nil
}
```

## React to specific GraphQL Directives

React to specific GraphQL directives in the subgraph schema and decide if the request should be forwarded to the subgraph. The following example checks if the `@requiresScopes` directive is present in the operation. Another example could be to check if the `@cacheControl` directive is present and set the cache control header on the response.

```go
type MyModule struct {
	Client *http.Client
}

func (m *MyModule) CacheControlDirectiveHandler(ctx *core.DirectiveContext) error {
	// Return an error to abort the request to the subgraph
	// The error is returned to the client as a GraphQL error

	// Find the minimum cache control directive in the operation to calculate the final cache time.
	// Finally, set the cache control header on the router response to the client in the OnRouterResponse hook.
	// The store is a shared context between all hooks and can be used to store and retrieve data.
	minAge := ctx.Directive.Args["maxAge"]
	currentAge := ctx.store.Get("cacheControl")
	if minAge < currentAge {
		ctx.store.Set("cacheControl", minAge)
	}

	return nil
}

func (m *MyModule) RequiresScopesDirectiveHandler(ctx *core.DirectiveContext) error {
	// Check if the user has the required scopes
	if !hasScopes(ctx.Request.Auth, ctx.Directive.Args["scopes"]) {
		return core.UnauthenticatedError("Unauthorized")
	}
	return nil
}

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	ctx.RegisterDirectiveHandler("cacheControl", m.CacheControlDirectiveHandler)
	ctx.RegisterDirectiveHandler("requiresScopes", m.RequiresScopesDirectiveHandler)
	return nil
}
```

## Validate GraphQL Scalar Types

GraphQL scalar types are meant to represent an indivisible value, like a string or an integer. Usually, a router can't validate the value of a scalar type because it's just a string. However, custom modules allows you to hook into the process before the value is sent to the subgraph and before it's sent to the client.
In our case, we ensure that the `Money` scalar type is a valid money format. We can validate the value of the scalar type in the `MoneyScalarHandler` hook and return an error if the value is invalid.

```go
type MyModule struct{}

func (m *MyModule) MoneyScalarHandler(ctx *core.ScalarContext) error {
	// Validate the Money scalar type
	if !isValidMoneyFormat(ctx.Value) {
		return core.ValidationError("Invalid money format")
	}
	return nil
}

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	ctx.RegisterScalarHandler("Money", m.MoneyScalarHandler)
	return nil
}
```


# Module Composition

Modules can be composed by chaining them together in the `Provision` method. This allows developers to create complex behavior by combining multiple modules which simplify testing and maintenance.
The order in which modules are composed determines the order in which they are executed. The submodules are executed first in the order they are registered, followed by the parent module.
Data from the parent module can be passed to the submodules as arguments in the constructor. Request and response data can be shared between modules using the request store.

```go
type MyModule struct{
	Value uint64 `yaml:"value"`
}

// Ensure that MyModule implements the RouterRequestHook interface
var _ RouterRequestHook = (*MyModule)(nil)

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	// Compose multiple modules together
	_ = ctx.RegisterModule(&ModuleB{
		value: m.Value,
	}, core.WithXyz("abc"))

	return nil
}

// ModuleB is a submodule of ModuleA

type ModuleB struct{
    value uint64
}

func (m *ModuleB) OnRouterRequest(req *core.RouterRequest, err error) error {
	// Access the parent module value
	m.value
	
	// Access the request store to share data between modules
	req.store.get("myData")

	return nil
}
```

# Module Registration

Modules are registered in the `main.go` file of the router application. The router will load the modules at startup and call the provision method to initialize them.
The order in which modules are registered determines the order in which they are executed. The first argument of `core.RegisterModule` accepts the module struct, and the second argument is a variadic list of options that can be passed to the module.

```go
func main() {
    // Register the custom module in the order you want them to be executed
    core.RegisterModule(&MyModule{}, core.WithXyz("abc"))

    // Start the router
    routercmd.Main()
}
```

Every custom router has its own `go.mod` file which represents in Go a module. This allows for reproducible builds and versioning of the custom router. The part below will be abstracted by a CLI tool in the future.
```go
// go.mod

module github.com/myorg/myrouter

go 1.23

require (
	"github.com/wundergraph/cosmo/router v0.93.0
	// Import your modules here
	github.com/myorg/mymodule v1.0.0
)
```

# Module Versioning

Modules can be versioned using Go Workspace module versioning. The version of a module is specified in the `go.mod` file of the module. The router will load the correct version of the module based on the version specified in the `go.mod` file. The version of a module can be updated by changing the version in the `go.mod` file and running `go mod tidy` to update the dependencies. Go workspaces are supported by VsCode, Goland, and other modern IDEs.

```
.
├── go.work
├── modules/
│   ├── go.mod
│   └── myModule.go
└── router/
    ├── main.go
    └── go.mod
```

## Outlook

Possible workflow to implement and build custom modules:

1. **Scaffolding**: A CLI tool that scaffolds a new custom module with a template and basic structure.
2. **Testing**: A testing framework that provides utilities to test custom modules in isolation and in combination with other modules.
3. **Deployment**: A deployment tool that packages custom modules into a binary or container image and deploys them to the router.

```bash
wgc router new-module myModule --router v0.93.0 # Scaffold a new custom module and specify the router version
wgc router test # Run tests for all custom modules
wgc router build --image-tag myRouter # Build a custom module and package it into our official router image
```

### Terminology

- **Router**: The main entry point for incoming GraphQL requests. The router is responsible for routing requests to the appropriate subgraphs and aggregating the responses.
- **Subgraph**: A GraphQL service that provides a subset of the overall schema. Subgraphs are connected to the router and can be queried independently or as part of a federated query.
- **Operation**: A GraphQL operation that is sent to the router. An operation can be a query, mutation, or subscription.
- **Request**: A GraphQL request that is sent to the router. A request can contain an operation, variables, and extensions.
- **Response**: A GraphQL response that is sent from the router to the client. A response can contain data, errors, and extensions.
- **Hooks**: Functions that are called at specific points in the router lifecycle. Hooks can be used to intercept and modify requests and responses, handle errors, and perform custom logic.
- **Telemetry**: The collection of data related to the router and subgraph lifecycle. Telemetry can include metrics, traces, and logs. OpenTelemetry is used to collect telemetry data in the Router.
- **Application**: The overall router application that includes the router, subgraphs, and custom modules. The application lifecycle includes startup, shutdown, and error handling.
- **Module**: A custom extension that can be added to the router. Modules can implement hooks to interact with the router lifecycle and customize behavior.