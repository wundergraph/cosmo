package core

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"go.uber.org/zap"
)

type ModuleV1Info struct {
	// ID is the unique identifier for a module, it must be unique across all modules.
	ID string
	// Priority decides the order of execution of the module.
	// The smaller the number, the higher the priority, the earlier the module is executed.
	// For example, a priority of 0 is the highest priority.
	// Modules with the same priority are executed in the order they are registered.
	// If Priority is nil, the module is considered to have the lowest priority.
	Priority *int
	// New creates a new instance of the module.
	New func() ModuleV1
}

// ModuleV1Context provides context and utilities for module provisioning
// Maintains feature parity with the old module system
type ModuleV1Context struct {
	context.Context
	Module ModuleV1
	Logger *zap.Logger
}

// ModuleV1 interface defines the contract for V1 modules.
//
// IMPORTANT: Concurrency Safety
// If your module stores state (fields, maps, slices, etc.), you MUST handle concurrency properly.
// The router is multi-threaded and your module methods may be called concurrently from different goroutines.
//
// Use synchronization primitives like sync.RWMutex for thread-safe access:
//
//	type MyModule struct {
//		mu    sync.RWMutex
//		data  map[string]int
//	}
//
//	func (m *MyModule) SafeRead() int {
//		m.mu.RLock()
//		defer m.mu.RUnlock()
//		return m.data["key"]
//	}
//
//	func (m *MyModule) SafeWrite(key string, value int) {
//		m.mu.Lock()
//		defer m.mu.Unlock()
//		m.data[key] = value
//	}
//
// Hook methods (if implemented) will be called concurrently during request processing.
// Provision() and Cleanup() are called once during router startup/shutdown and are inherently safe.
type ModuleV1 interface {
	Module() ModuleV1Info
	// Provisioner is called before the server starts
	// It allows you to initialize your module e.g. create a database connection
	Provision(ctx *ModuleV1Context) error
	// Cleanup is called after the server stops
	// It allows you to clean up your module e.g. close a database connection
	Cleanup(ctx *ModuleV1Context) error
}

// sortModulesV1 sorts the modules by priority, 0 is the highest priority, is the first to be executed.
// If two modules have the same priority, they are sorted by registration order.
// If a module has no priority, it is considered to have the lowest priority.
func sortModulesV1(modules []ModuleV1Info) []ModuleV1Info {
	sort.Slice(modules, func(i, j int) bool {
		var priorityI, priorityJ int = math.MaxInt, math.MaxInt
		if modules[i].Priority != nil {
			priorityI = *modules[i].Priority
		}
		if modules[j].Priority != nil {
			priorityJ = *modules[j].Priority
		}

		return priorityI < priorityJ
	})
	return modules
}

// coreModuleHooks manages module initialization and hook registration.
type coreModuleHooks struct {
	moduleInstances []ModuleV1
	hookRegistry    *hookRegistry
	logger          *zap.Logger
}

func newCoreModuleHooks(logger *zap.Logger) *coreModuleHooks {
	return &coreModuleHooks{
		hookRegistry: newHookRegistry(),
		logger:       logger,
	}
}

// initCoreModuleHooks instantiates each module, provisions it,
// registers any implemented hooks, and saves the hook registry.
func (c *coreModuleHooks) initCoreModuleHooks(ctx context.Context, modules []ModuleV1Info) error {
	hookRegistry := newHookRegistry()
	var instances []ModuleV1

	for _, info := range modules {
		now := time.Now()
		moduleInstance := info.New()

		moduleCtx := &ModuleV1Context{
			Context: ctx,
			Module:  moduleInstance,
			Logger:  c.logger.Named(info.ID),
		}

		if err := moduleInstance.Provision(moduleCtx); err != nil {
			return newModuleV1Error(info.ID, PhaseProvision, err)
		}

		hookRegistry.AddApplicationLifecycle(moduleInstance, info.ID)
		hookRegistry.AddGraphQLServerLifecycle(moduleInstance, info.ID)
		hookRegistry.AddRouterLifecycle(moduleInstance, info.ID)
		hookRegistry.AddSubgraphLifecycle(moduleInstance, info.ID)
		hookRegistry.AddOperationLifecycle(moduleInstance, info.ID)

		c.logger.Info("Core Module System: Module registered",
			zap.String("id", string(info.ID)),
			zap.String("duration", time.Since(now).String()),
		)

		instances = append(instances, moduleInstance)
	}

	c.hookRegistry = hookRegistry
	c.moduleInstances = instances

	return nil
}

func (c *coreModuleHooks) cleanupCoreModuleHooks(ctx context.Context) error {
	var errs []error
	for _, moduleInstance := range c.moduleInstances {
		moduleCtx := &ModuleV1Context{
			Context: ctx,
			Module:  moduleInstance,
			Logger:  c.logger.Named(moduleInstance.Module().ID),
		}
		if err := moduleInstance.Cleanup(moduleCtx); err != nil {
			errs = append(errs, newModuleV1Error(moduleInstance.Module().ID, PhaseCleanup, err))
		}
	}

	return errors.Join(errs...)
}

// ModuleV1Error provides structured error information for module operations
type ModuleV1Error struct {
	ModuleID string
	Phase    phase
	HookName *string
	Err      error
}

type phase string

const (
	PhaseProvision phase = "provision"
	PhaseCleanup   phase = "cleanup"
	PhaseHook      phase = "hook"
)

func (e *ModuleV1Error) Error() string {
	if e.Phase == PhaseHook && e.HookName != nil {
		return fmt.Sprintf("module %s %s %s error: %v", e.ModuleID, e.Phase, *e.HookName, e.Err)
	}
	return fmt.Sprintf("module %s %s error: %v", e.ModuleID, e.Phase, e.Err)
}

func (e *ModuleV1Error) Unwrap() error {
	return e.Err
}

func newModuleV1Error(moduleID string, phase phase, err error) error {
	return &ModuleV1Error{
		ModuleID: moduleID,
		Phase:    phase,
		Err:      err,
	}
}

func newModuleV1HookError(moduleID, hookName string, err error) error {
	return &ModuleV1Error{
		ModuleID: moduleID,
		Phase:    PhaseHook,
		HookName: &hookName,
		Err:      err,
	}
}
