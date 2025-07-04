package core

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"go.uber.org/zap"
)

type moduleRegistry struct {
	mu      sync.RWMutex
	modules map[string]ModuleV1Info
}

// NewModuleRegistry returns an empty, thread-safe module registry.
// Call this in tests (and anywhere you need isolation) instead of using the global.
func newModuleRegistry() *moduleRegistry {
	return &moduleRegistry{
		modules: make(map[string]ModuleV1Info),
	}
}

// defaultModuleRegistry is the package-level registry used by RegisterModuleV1.
// For unit tests you should use newModuleRegistry() to get a fresh instance and avoid shared state.
var defaultModuleRegistry = newModuleRegistry()

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

type ModuleV1 interface {
	Module() ModuleV1Info
	// Provisioner is called before the server starts
	// It allows you to initialize your module e.g. create a database connection
	Provision(ctx *ModuleV1Context) error
	// Cleanup is called after the server stops
	// It allows you to clean up your module e.g. close a database connection
	Cleanup(ctx *ModuleV1Context) error
}

// RegisterModuleV1 registers a new ModuleV1 instance.
// The registration order matters. Modules with the same priority
// are executed in the order they are registered.
// It panics if the module is already registered.
func RegisterModuleV1(instance ModuleV1) {
	defaultModuleRegistry.registerModuleV1(instance)
}

func (r *moduleRegistry) registerModuleV1(instance ModuleV1) {
	m := instance.Module()

	if m.ID == "" {
		panic("ModuleV1.ID is required")
	}
	if val := m.New(); val == nil {
		panic(fmt.Sprintf("ModuleV1Info.New must return a non-nil module instance: %s", m.ID))
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.modules[m.ID]; ok {
		panic(fmt.Sprintf("ModuleV1 already registered: %s", m.ID))
	}
	r.modules[m.ID] = m
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

// getModulesV1 returns all registered modules sorted by priority
func (r *moduleRegistry) getModulesV1() []ModuleV1Info {
	r.mu.RLock()
	defer r.mu.RUnlock()

	modules := make([]ModuleV1Info, 0, len(r.modules))
	for _, m := range r.modules {
		modules = append(modules, m)
	}
	return sortModulesV1(modules)
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
