package core

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/utils"

	"go.uber.org/zap/zaptest"
)

type testModule1 struct{}

func (m *testModule1) Module() ModuleV1Info {
	return ModuleV1Info{
		ID:       "testModule1",
		Priority: utils.Ptr(0),
		New: func() ModuleV1 {
			return &testModule1{}
		},
	}
}
func (m *testModule1) Provision(ctx *ModuleV1Context) error { return nil }
func (m *testModule1) Cleanup(ctx *ModuleV1Context) error   { return errors.New("test error 1") }

func (m *testModule1) OnApplicationStart(ctx ApplicationStartHookContext) error { return nil }

type testModule2 struct{}

func (m *testModule2) Module() ModuleV1Info {
	return ModuleV1Info{
		ID:       "testModule2",
		Priority: utils.Ptr(1),
		New: func() ModuleV1 {
			return &testModule2{}
		},
	}
}
func (m *testModule2) Provision(ctx *ModuleV1Context) error { return nil }
func (m *testModule2) Cleanup(ctx *ModuleV1Context) error   { return nil }

func (m *testModule2) OnApplicationStart(ctx ApplicationStartHookContext) error { return nil }
func (m *testModule2) OnApplicationStop(ctx ApplicationStopHookContext) error   { return nil }

type testModule3 struct{}

func (m *testModule3) Module() ModuleV1Info {
	return ModuleV1Info{
		Priority: utils.Ptr(1),
		New: func() ModuleV1 {
			return &testModule3{}
		},
	}
}
func (m *testModule3) Provision(ctx *ModuleV1Context) error { return nil }
func (m *testModule3) Cleanup(ctx *ModuleV1Context) error   { return nil }

func (m *testModule3) OnApplicationStart(ctx ApplicationStartHookContext) error { return nil }
func (m *testModule3) OnApplicationStop(ctx ApplicationStopHookContext) error   { return nil }

type testModule4 struct{}

func (m *testModule4) Module() ModuleV1Info {
	return ModuleV1Info{
		ID:       "testModule4",
		Priority: utils.Ptr(1),
	}
}
func (m *testModule4) Provision(ctx *ModuleV1Context) error { return nil }
func (m *testModule4) Cleanup(ctx *ModuleV1Context) error   { return errors.New("test error 4") }

// interface guards
var _ ApplicationStartHook = (*testModule1)(nil)

// registers the applicationStartHook only once
var _ ApplicationStartHook = (*testModule2)(nil)
var _ ApplicationLifecycleHook = (*testModule2)(nil)

var _ ApplicationStartHook = (*testModule3)(nil)
var _ ApplicationStopHook = (*testModule3)(nil)

func TestSortModulesV1(t *testing.T) {
	t.Parallel()

	module0 := ModuleV1Info{
		ID:       "module0",
		Priority: utils.Ptr(0),
	}

	module1 := ModuleV1Info{
		ID:       "module1",
		Priority: utils.Ptr(1),
	}

	module2 := ModuleV1Info{
		ID:       "module2",
		Priority: utils.Ptr(2),
	}

	module3 := ModuleV1Info{
		ID:       "module3",
		Priority: utils.Ptr(0),
	}

	moduleNilPriority := ModuleV1Info{
		ID: "moduleNil",
	}

	t.Run("success", func(t *testing.T) {
		modules := []ModuleV1Info{
			moduleNilPriority,
			module2,
			module0,
			module1,
		}
		result := sortModulesV1(modules)

		expected := []ModuleV1Info{
			module0,
			module1,
			module2,
			moduleNilPriority,
		}

		require.EqualValues(t, expected, result)
	})

	t.Run("same priority", func(t *testing.T) {
		modules := []ModuleV1Info{
			module3,
			module0,
		}
		result := sortModulesV1(modules)

		expected := []ModuleV1Info{
			module3,
			module0,
		}

		require.EqualValues(t, expected, result)
	})

	t.Run("no modules not panic", func(t *testing.T) {
		modules := []ModuleV1Info{}
		require.Equal(t, []ModuleV1Info{}, sortModulesV1(modules))
	})
}

func TestInitModulesV1(t *testing.T) {
	t.Parallel()

	t.Run("success", func(t *testing.T) {
		modules := []ModuleV1Info{
			{
				ID: "testModule1",
				New: func() ModuleV1 {
					return &testModule1{}
				},
			},
			{
				ID: "testModule3",
				New: func() ModuleV1 {
					return &testModule3{}
				},
			},
		}
		cm := newCoreModuleHooks(zaptest.NewLogger(t))
		err := cm.initCoreModuleHooks(context.Background(), modules)
		require.NoError(t, err)

		require.Equal(t, 2, len(cm.hookRegistry.applicationStartHooks.Values()))
		require.Equal(t, 1, len(cm.hookRegistry.applicationStopHooks.Values()))
	})
}

func TestCleanupModulesV1(t *testing.T) {
	t.Parallel()

	t.Run("all modules get a chance to cleanup", func(t *testing.T) {
		modules := []ModuleV1Info{
			{
				ID: "testModule1",
				New: func() ModuleV1 {
					return &testModule1{}
				},
			},
			{
				ID: "testModule2",
				New: func() ModuleV1 {
					return &testModule2{}
				},
			},
			{
				ID: "testModule4",
				New: func() ModuleV1 {
					return &testModule4{}
				},
			},
		}
		cm := newCoreModuleHooks(zaptest.NewLogger(t))
		err := cm.initCoreModuleHooks(context.Background(), modules)
		require.NoError(t, err)

		err = cm.cleanupCoreModuleHooks(context.Background())
		require.Error(t, err)
		require.Equal(t, "module testModule1 cleanup error: test error 1\nmodule testModule4 cleanup error: test error 4", err.Error())
	})
}

type failingProvisionModule struct{}

func (m *failingProvisionModule) Module() ModuleV1Info {
	return ModuleV1Info{
		ID: "failing-provision-module",
		New: func() ModuleV1 {
			return &failingProvisionModule{}
		},
	}
}

func (m *failingProvisionModule) Provision(ctx *ModuleV1Context) error {
	return errors.New("provision failed")
}

func (m *failingProvisionModule) Cleanup(ctx *ModuleV1Context) error {
	return nil
}

func TestProvisionErrors(t *testing.T) {
	t.Parallel()

	t.Run("provision failure stops initialization", func(t *testing.T) {
		modules := []ModuleV1Info{
			{
				ID: "failing-provision-module",
				New: func() ModuleV1 {
					return &failingProvisionModule{}
				},
			},
		}

		cm := newCoreModuleHooks(zaptest.NewLogger(t))
		err := cm.initCoreModuleHooks(context.Background(), modules)

		require.Error(t, err)
		var moduleErr *ModuleV1Error
		require.True(t, errors.As(err, &moduleErr))
		require.Equal(t, "failing-provision-module", moduleErr.ModuleID)
		require.Equal(t, PhaseProvision, moduleErr.Phase)
	})
}

type failingHookModule struct{}

func (m *failingHookModule) OnApplicationStart(ctx ApplicationStartHookContext) error {
	return errors.New("hook execution failed")
}

func TestHookExecution(t *testing.T) {
	t.Parallel()

	t.Run("hook execution with error", func(t *testing.T) {
		hooks := []moduleHook[ApplicationStartHook]{
			{
				ID:   "failing-module",
				Hook: &failingHookModule{},
			},
		}

		err := executeHooks(hooks, func(h ApplicationStartHook) error {
			return h.OnApplicationStart(nil)
		}, "OnApplicationStart", zaptest.NewLogger(t))

		require.Error(t, err)
		var moduleErr *ModuleV1Error
		require.True(t, errors.As(err, &moduleErr))
		require.Equal(t, "failing-module", moduleErr.ModuleID)
		require.Equal(t, PhaseHook, moduleErr.Phase)
		require.Equal(t, "OnApplicationStart", *moduleErr.HookName)
	})

	t.Run("hook execution success", func(t *testing.T) {
		hooks := []moduleHook[ApplicationStartHook]{
			{
				ID:   "test-module",
				Hook: &testModule1{},
			},
		}

		err := executeHooks(hooks, func(h ApplicationStartHook) error {
			return h.OnApplicationStart(nil)
		}, "OnApplicationStart", zaptest.NewLogger(t))

		require.NoError(t, err)
	})
}

func TestModuleV1Error(t *testing.T) {
	t.Parallel()

	t.Run("provision error", func(t *testing.T) {
		err := newModuleV1Error("test-module", PhaseProvision, errors.New("foo"))
		moduleErr := err.(*ModuleV1Error)

		require.Equal(t, "test-module", moduleErr.ModuleID)
		require.Equal(t, PhaseProvision, moduleErr.Phase)
		require.Nil(t, moduleErr.HookName)
		require.Equal(t, "module test-module provision error: foo", err.Error())
	})

	t.Run("cleanup error", func(t *testing.T) {
		err := newModuleV1Error("test-module", PhaseCleanup, errors.New("foo"))
		moduleErr := err.(*ModuleV1Error)

		require.Equal(t, "test-module", moduleErr.ModuleID)
		require.Equal(t, PhaseCleanup, moduleErr.Phase)
		require.Nil(t, moduleErr.HookName)
		require.Equal(t, "module test-module cleanup error: foo", err.Error())
	})

	t.Run("hook error", func(t *testing.T) {
		err := newModuleV1HookError("test-module", "OnApplicationStart", errors.New("foo"))
		moduleErr := err.(*ModuleV1Error)

		require.Equal(t, "test-module", moduleErr.ModuleID)
		require.Equal(t, PhaseHook, moduleErr.Phase)
		require.NotNil(t, moduleErr.HookName)
		require.Equal(t, "OnApplicationStart", *moduleErr.HookName)
		require.Equal(t, "module test-module hook OnApplicationStart error: foo", err.Error())
	})

	t.Run("error unwrapping", func(t *testing.T) {
		originalErr := errors.New("original error")
		err := newModuleV1Error("test-module", PhaseProvision, originalErr)

		require.Equal(t, originalErr, errors.Unwrap(err))
	})
}
