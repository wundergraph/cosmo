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

This RFC describes an overhaul of the current module system in the router. The new module system is designed to be more flexible and native to GraphQL. It allows developers to hook into the gateway lifecycle as well as outgoing and incoming requests to subgraphs.

## Introduction

As of today, customers can extend the router with custom modules. These modules can be used to change the behavior of the router, add custom logic, or integrate with other systems. The current module system has several limitations that we want to address with this RFC:

- The current module system is not native to GraphQL. It is based on HTTP middleware and does not provide a GraphQL-specific API.
- The current module system is inconsistent and hard to use. It does not provide a clear API for developers to intercept and modify GraphQL requests and responses.
- The current module system does not provide a way to create or modify OpenTelemetry data, logs for different parts of the gateway lifecycle.
- The current module system does not provide a way to interact with the parsed, normalized, and planned GraphQL operation in order to implement custom logic.

Ultimately, custom modules must be self-contained, composable and testable. They should provide a clear API for developers to interact with the gateway and subgraph lifecycle and implement custom logic without having to understand the internal workings of the router or advanced Go programming concepts.
To briefly explain the decision to use Go as the language for the module system, we have chosen Go because it is a simple and easy-to-learn language that is widely used in the infrastructure and cloud-native ecosystem. You can build custom integration on top production-grade SDK without re-implementing them from scratch. It superiors to scripting languages like Rhai or cross-compiling WebAssembly because it can be easily debugged, profiled, and tested with any modern IDE (VsCode, Goland, etc.). Not part of this RFC, are our ambitions to make the workflow as smooth as possible with a CLI tool that can scaffold, test, and deploy custom modules. In the future, custom modules could be published to a central registry and shared with the community. A brief overview of the workflow is provided at the end of this RFC.

As powerful as the new module becomes, it is important to move basic and common functionality into the core of the router because building and maintaining custom modules should be a last resort. The router should provide a rich set of features out of the box that cover the most common use cases. Custom modules should be reserved for advanced or highly specific use cases that cannot be achieved with the built-in features of the router. Integration with third-party services, custom authentication, and advanced telemetry are examples of use cases that are well-suited for custom modules.

## Old Module System

<details>

<summary>The current module system (Click here)</summary>

### Specification

```go
const myModuleID = "myModule"

// MyModule is a simple module that has access to the GraphQL operation and add a header to the response
// It demonstrates how to use the different handlers to customize the router.
// It also shows how to use the config file to configure and validate your module config.
// By default, the config file is located at `config.yaml` in the working directory of the router.
type MyModule struct {
	// Properties that are set by the config file are automatically populated based on the `mapstructure` tag
	// Create a new section under `modules.<name>` in the config file with the same name as your module.
	// Don't forget in Go the first letter of a property must be uppercase to be exported

	Value uint64 `mapstructure:"value"`

	Logger *zap.Logger
}

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	// Provision your module here, validate config etc.

	if m.Value == 0 {
		ctx.Logger.Error("Value must be greater than 0")
		return fmt.Errorf("value must be greater than 0")
	}

	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *MyModule) Cleanup() error {
	// Shutdown your module here, close connections etc.

	return nil
}

func (m *MyModule) OnOriginResponse(response *http.Response, ctx core.RequestContext) *http.Response {
	// Return a new response or nil if you want to pass it to the next handler
	// If you want to modify the response, return a new response

	// Access the custom value set in OnOriginRequest
	value := ctx.GetString("myValue")

	fmt.Println("SharedValue", value)

	fmt.Println("OnOriginResponse", response.Request.URL, response.StatusCode)

	return nil
}

func (m *MyModule) OnOriginRequest(request *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	// Return the modified request or nil if you want to pass it to the next handler
	// Return a new response if you want to abort the request and return a custom response

	// Set a header on all origin requests
	request.Header.Set("myHeader", ctx.GetString("myValue"))

	// Set a custom value on the request context. See OnOriginResponse
	ctx.Set("myValue", "myValue")

	return request, nil
}

func (m *MyModule) Middleware(ctx core.RequestContext, next http.Handler) {

	operation := ctx.Operation()

	// Access the GraphQL operation context
	fmt.Println(
		operation.Name(),
		operation.Type(),
		operation.Hash(),
		operation.Content(),
	)

	// Call the next handler in the chain or return early by calling w.Write()
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *MyModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &MyModule{}
		},
	}
}

// Interface guard
var (
	_ core.RouterMiddlewareHandler = (*MyModule)(nil)
	_ core.EnginePreOriginHandler  = (*MyModule)(nil)
	_ core.EnginePostOriginHandler = (*MyModule)(nil)
	_ core.Provisioner             = (*MyModule)(nil)
	_ core.Cleaner                 = (*MyModule)(nil)
)
```

</details>

## Proposal

A developer can implement a custom module by creating a struct that implements one or more of the following interfaces:

- `GatewayHooks`: Provides hooks for the gateway lifecycle, including request and response handling.
- `SubgraphHooks`: Provides hooks for subgraph requests and responses.
- `ApplicationHooks`: Provides hooks for the application lifecycle, including startup, shutdown, and error handling.
- `TelemetryHooks`: Provides hooks for OpenTelemetry spans and metrics.
- `OperationHooks`: Provides hooks for parsed, normalized, and planned GraphQL operations.
- `Module`: Provides hooks for the module lifecycle, including provisioning and cleanup.

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

type Graph struct {
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

type GatewayRequest struct {
	// The original GraphQL request with all the information like query, variables, operation name, extensions etc.
	Request *core.GraphQLRequest
	// The parsed, normaliazed and planned operation with all the information like name, variables, type, document representation,
	// client name version, uploaded files, plan, normalization, persisted operation etc.
	Operation *core.Operation
	// The active Telemetry instance
	Telemetry *core.Telemetry
	// The active graph
	Graph *core.Graph
	// The original HTTP request
	Orignal *http.Request
	// Logger for the gateway request
	Logger *zap.Logger
}

type GatewayResponse struct {
	// The original RouterRequest
	Request *core.GatewayRequest
	// The active Telemetry instance
	Telemetry *core.Telemetry
	// The final GraphQL response with all the information like data, errors, extensions etc.
	// This is the response that will be sent to the client and can be manipulated or replaced
	Response *core.GraphQLResponse
	// The original HTTP response
	Orignal *http.Response
}

type GatewayHooks interface {
	// OnRequest is called when a request is made to the gateway and after all GraphQL information is available
	// Returning an error will result in a GraphQL error being returned to the client.
	OnGatewayRequest(ctx *core.GatewayRequest, err error) error
	// OnResponse is called before the response is sent to the client
	// Returning an error will result in a GraphQL error being returned to the client.
	OnGatewayResponse(ctx *core.GatewayResponse, err error) error
	// OnError is called when an error occurs during the gateway lifecycle
	OnGatewayError(err error)
}

type SubgraphRequest struct {
	// The active subgraph
	Subgraph *core.Subgraph
	// The original Gateway request
	GatewayRequest *core.RouterRequest
	// The final GraphQL request to the subgraph
	Request *core.GraphQLRequest
	// The active Telemetry instance
	Telemetry *core.Telemetry
	// The original http request to the subgraph
	Orignal *http.Request
	// Logger for the subgraph request
	Logger *zap.Logger
}

type SubgraphResponse struct {
	// The active subgraph
	Subgraph *core.Subgraph
	// The original Gateway request
	GatewayRequest *core.GatewayRequest
	// The active Telemetry instance
	Telemetry *core.Telemetry
	// The final GraphQL response from the subgraph
	Response *core.GraphQLResponse
	// The original http response from the subgraph
	Orignal *http.Response
}

// SubgraphHooks are called when a subgraph request or response is made.
// The order is not guaranteed, so the hooks should be idempotent and side-effect free.
// if state needs to be shared between hooks, it should be stored in the context.
// We will provide an easy way to share state between hooks.
type SubgraphHooks interface {
	// OnRequest is called when a subgraph request is made.
	// Returning an error will result in a GraphQL error as a response from the subgraph.
	OnSubgraphRequest(req *core.SubgraphRequest, err error) error
	// OnResponse is called when a subgraph response is received
	// Returning an error will result in a GraphQL error as a response from the subgraph.
	OnSubgraphResponse(res *core.SubgraphResponse, err error) error
	// OnError is called when an error occurs during the subgraph lifecycle request/response or any other error
	OnError(err error)
}

type ApplicationHooks interface {
	// OnStart is called when the application starts
	OnAppStart() error
	// OnStop is called when the application stops
	OnAppStop() error
	// OnError is called when an error occurs during the application lifecycle start/stop or any other error
	OnAppError(err error)
}

type TelemetryHooks interface {
	// OnSpanStart is called when a span is created
	// Returning a function to be called when the span ends.
	// This can be used to add custom attributes or events to the span.
	OnSpan(span *trace.Span) func() // Return a function to be called when the span ends
}

type OperationHooks interface {
	// OnNormalize is called when an operation is normalized
	// Returning an error will result in a GraphQL error as a response from the gateway.
	OnOperationNormalize(op *core.Operation, err error) error
	// OnPlan is called when an operation is planned
	// Returning an error will result in a GraphQL error as a response from the gateway.
	OnOperationPlan(op *core.Operation, err error) error
}

var _ GatewayHooks = (*MyModule)(nil)

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	// Initialize your module here, open connections etc.
	return nil
}

func (m *MyModule) Cleanup() error {
	// Shutdown your module here, close connections etc.
	return nil
}
```

## Example Use Cases

- **Advanced GraphQL Operation Handling**: A module that walks the parsed operation and performs custom logic based on the operation type, fields, and arguments.
- **Request validation**: A module that validates incoming requests and returns an error if the request is invalid.
- **Custom Telemetry**: A module that collects custom span or metric data and sends it to a telemetry backend.
- **Custom Authentication**: A module that authenticates incoming requests and adds user information to the subgraph requests.
- **Response interception**: A module that intercepts responses from subgraphs and modifies them before they are sent to the client.
- **Response Caching**: A module that caches responses from subgraphs and returns them for identical requests.
- **Enriching Logs**: A module that adds custom log fields to the gateway and subgraph logs.


## Backwards Compatibility

The new module system is not backwards compatible with the old module system. Existing custom modules will need to be rewritten to use the new interfaces and API. We will provide a migration guide and tooling to help developers migrate their custom modules to the new system.

# Example Modules

## Custom Telemetry

This module adds custom attributes to the OpenTelemetry span for each gateway request. Data can come from the request, the gateway configuration, or external sources.

```go
type MyModule struct{}

var _ GatewayHooks = (*MyModule)(nil)

func (m *MyModule) OnGatewayRequest(req *core.GatewayRequest, err error) error {
    req.Telemetry.Span.AddEvent("Gateway Request")
	req.Telemetry.Span.AddAttributes(
        attribute.String("gateway.name", "myGateway"),
        attribute.String("gateway.version", "v1"),
    )
    return nil
}
```

## Intercepting Gateway Responses

This module intercepts the final Gateway response to rewrite errors and add custom extensions.

```go
type MyModule struct{}

var _ GatewayHooks = (*MyModule)(nil)

func (m *MyModule) OnGatewayResponse(res *core.GatewayResponse, err error) error {
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

This module adds custom log fields to the gateway and subgraph logs. Data can come from the request, the response, or external sources.

```go
type MyModule struct{}

var _ GatewayHooks = (*MyModule)(nil)

func (m *MyModule) OnGatewayRequest(req *core.GatewayRequest, err error) error {
    // Add custom fields to the gateway log
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

var _ SubgraphHooks = (*MyModule)(nil)

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

# Custom Module configuration

Custom modules can be configured using a YAML file that is loaded by the router at startup. We reserve a section in the configuration file for custom modules. Each module can have its own configuration section with custom properties.

```yaml
modules:
  myModule:
    value: 42
```

At module provisioning, the configuration is loaded and can be marshaled into the module struct, where it can be accessed across the module lifecycle.

```go
type MyModule struct {
	Value uint64 `yaml:"value"`
}

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	// Access the module configuration marshaled from the config file into the struct
	cfg, err := ctx.Config()
	if err != nil {
		return err
	}

	// Access the custom value from the configuration
	m.Value
}
```

# Module Registration

Modules are registered in the main.go file of the router application. The router will load the modules at startup and call the provision method to initialize them.
The order in which modules are registered determines the order in which they are executed. The first argument of `core.RegisterModule` accepts the module struct, and the second argument is a variadic list of options that can be passed to the module.

```go
func main() {
    // Register the custom module in the order you want them to be executed
    core.RegisterModule(&MyModule{}, core.WithXyz("abc"))

    // Start the router
    routercmd.Main()
}
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

- **Gateway**: The main entry point for incoming GraphQL requests. The gateway is responsible for routing requests to the appropriate subgraphs and aggregating the responses.
- **Subgraph**: A GraphQL service that provides a subset of the overall schema. Subgraphs are connected to the gateway and can be queried independently or as part of a federated query.
- **Operation**: A GraphQL operation that is sent to the gateway. An operation can be a query, mutation, or subscription.
- **Request**: A GraphQL request that is sent to the gateway. A request can contain an operation, variables, and extensions.
- **Response**: A GraphQL response that is sent from the gateway to the client. A response can contain data, errors, and extensions.
- **Hooks**: Functions that are called at specific points in the gateway lifecycle. Hooks can be used to intercept and modify requests and responses, handle errors, and perform custom logic.
- **Telemetry**: The collection of data related to the gateway and subgraph lifecycle. Telemetry can include metrics, traces, and logs. OpenTelemetry is used to collect telemetry data in the gateway.
- **Application**: The overall gateway application that includes the gateway, subgraphs, and custom modules. The application lifecycle includes startup, shutdown, and error handling.
- **Module**: A custom extension that can be added to the gateway. Modules can implement hooks to interact with the gateway lifecycle and customize behavior.