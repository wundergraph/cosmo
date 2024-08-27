---
title: "Router Custom Metric Module System"
author: Kaia Lang
date: 2024-08-27
status: Draft
---

# Router Custom Metric Module System

- **Author:** Kaia Lang
- **Date:** 2024-08-27
- **Status:** Draft

## Abstract

This RFC proposes a new design for a custom metric module system within the router. The new system aims to provide greater flexibility and extensibility, allowing developers to easily integrate custom metrics and observability tools. It will enable modules to hook into various stages of the router lifecycle, including incoming and outgoing requests to subgraphs. This enhancement allows users to choose and implement their preferred monitoring system, facilitating more granular monitoring and analytics.

## Introduction

As of today, the router provides built-in support for metrics through OTel and Prometheus, as well as schema usage through a schema exporter. While this offers a good out-of-the-box experience, it is somewhat rigid and limits customization options for users who need to tailor their monitoring strategies across different metrics systems to meet unique business requirements.

- The current system does not allow users to easily integrate different metrics clients, choose the set of attributes or measure at different event points. 
- It requires users to modify the core codebase implement custom solution, increasing complexity and risk of inadvertently affecting existing users due to the lack of isolation between differnt metrics implementations.

## Proposal

A developer can implement a custom metric module by creating a struct that implements one of more the following interfaces. There are two sets of interfaces. 
- The adapted visitor pattern, one interface per event point to provide full control over the router lifecycle.
- The logically grouped interface built on top of the above set of interfaces for simpler integration.

```go
type MetricInfo struct {
    // core.OperationContext contains all information needed including schema usage info
	Operation core.OperationContext // making core.operationContext accessible outside of its package
}

type MetricRouterPreRequestHook interface {
	EnterRouterRequest(ctx context.Context, info MetricInfo) error
}

type MetricRouterPostRequestHook interface {
	LeaveRouterRequest(ctx context.Context, err error, statusCode int, info MetricInfo) error
}

type MetricRouterRequestHook interface {
	MetricRouterPreRequestHook
	MetricRouterPostRequestHook
}

type MetricSubgraphPreRequestHook interface {
	EnterSubgraphRequest(ctx context.Context, info MetricInfo) error
}

type MetricSubgraphPostRequestHook interface {
	LeaveSubgraphRequest(ctx context.Context, err error, statusCode int, info MetricInfo) error
}

type MetricSubgraphRequestHook interface {
	MetricSubgraphPreRequestHook
	MetricSubgraphPostRequestHook
}

type MetricOperationPreParseHook interface {
	EnterOperationParse(ctx context.Context, info MetricInfo) error
}

type MetricOperationPostParseHook interface {
	LeaveOperationParse(ctx context.Context, err error, statusCode int, info MetricInfo) error
}

type MetricOperationParseHook interface {
	MetricOperationPreParseHook
	MetricOperationPostParseHook
}

type MetricOperationPreNormalizeHook interface {
	EnterOperationNormalize(ctx context.Context, info MetricInfo) error
}

type MetricOperationPostNormalizeHook interface {
	LeaveOperationNormalize(ctx context.Context, err error, statusCode int, info MetricInfo) error
}

type MetricOperationNormalizeHook interface {
	MetricOperationPreNormalizeHook
	MetricOperationPostNormalizeHook
}

type MetricOperationPreValidateHook interface {
	EnterOperationValidate(ctx context.Context, info MetricInfo) error
}

type MetricOperationPostValidateHook interface {
	LeaveOperationValidate(ctx context.Context, err error, statusCode int, info MetricInfo) error
}

type MetricOperationValidateHook interface {
	MetricOperationPreValidateHook
	MetricOperationPostValidateHook
}

type MetricOperationPrePlanHook interface {
	EnterOperationPlan(ctx context.Context, info MetricInfo) error
}

type MetricOperationPostPlanHook interface {
	LeaveOperationPlan(ctx context.Context, err error, statusCode int, info MetricInfo) error
}

type MetricOperationPlanHook interface {
	MetricOperationPrePlanHook
	MetricOperationPostPlanHook
}

type MetricOperationPreExecuteHook interface {
	EnterOperationExecute(ctx context.Context, info MetricInfo) error
}

type MetricOperationPostExecuteHook interface {
	LeaveOperationExecute(ctx context.Context, err error, statusCode int, info MetricInfo) error
}

type MetricOperationExecuteHook interface {
	MetricOperationPreExecuteHook
	MetricOperationPostExecuteHook
}

type MetricOperationHook interface {
	MetricOperationParseHook
	MetricOperationNormalizeHook
	MetricOperationValidateHook
	MetricOperationPlanHook
	MetricOperationExecuteHook
}

type CloseHook interface {
	Close(ctx context.Context) error
}
```

## Backwards Compatibility

The new module system is backwards compatible with the existing metrics system. However, to ensure clear isolation and consistency, we will migrate the existing metrics system to the new metric modules as default modules.

## Sample Use Case

1. To record request count, request latency using my custom metric module

```go
type MyModule struct{}

var _ MetricRouterRequestHook = (*MyModule)(nil)

func (m *MyModule) EnterRouterRequest(req *core.RouterRequest, err error) error {
    // A counter for recording the number of incoming requests.
    // Get the start time of the request, store it in the context, and pass it along.
	return nil
}

func (m *MyModule) LeaveRouterRequest(ctx context.Context, err error, statusCode int, info MetricInfo) error {
    // A counter for recording the success and error returns.
    // Get the start time from the request to measure the latency
    return nil
}
```

2. To emit schema usage info

```go
type MyModule struct{}

var _ MetricRouterPostRequestHook = (*MyModule)(nil)

func (m *MyModule) LeaveRouterRequest(ctx context.Context, err error, statusCode int, info MetricInfo) error {
    // Extrac schema usage info from OperationContext and emit to my module
    return nil
}
```

3. To record planCache metrics

```go
type MyModule struct{}

var _ MetricOperationPlanHook = (*MyModule)(nil)

func (m *MyModule) EnterOperationPlan(ctx context.Context, info MetricInfo) error {
    // Record plan cache lookup
    return nil 
}

func (m *MyModule) LeaveOperationPlan(ctx context.Context, err error, statusCode int, info MetricInfo) error {
    // Record plan cache hit and miss
    return nil
}
```
