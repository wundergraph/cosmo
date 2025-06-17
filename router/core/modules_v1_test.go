package core

import (
	"testing"
	"context"
	"errors"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/utils"

	"go.uber.org/zap/zaptest"
)


type testModule1 struct {}

func (m *testModule1) MyModule() MyModuleInfo {
	return MyModuleInfo{
		ID: "testModule1",
		Priority: utils.Ptr(0),
		New: func() MyModule {
			return &testModule1{}
		},
	}
}
func (m *testModule1) Provision(ctx context.Context) error { return nil }
func (m *testModule1) Cleanup(ctx context.Context) error { return errors.New("test error 1") }

func (m *testModule1) OnApplicationStart(ctx context.Context) {}

type testModule2 struct {}

func (m *testModule2) MyModule() MyModuleInfo {
	return MyModuleInfo{
		ID: "testModule2",
		Priority: utils.Ptr(1),
		New: func() MyModule {
			return &testModule2{}
		},
	}
}
func (m *testModule2) Provision(ctx context.Context) error { return nil }
func (m *testModule2) Cleanup(ctx context.Context) error { return nil }

func (m *testModule2) OnApplicationStart(ctx context.Context) {}
func (m *testModule2) OnApplicationStop(ctx context.Context) {}

type testModule3 struct {}

func (m *testModule3) MyModule() MyModuleInfo {
	return MyModuleInfo{
		Priority: utils.Ptr(1),
		New: func() MyModule {
			return &testModule3{}
		},
	}
}
func (m *testModule3) Provision(ctx context.Context) error { return nil }
func (m *testModule3) Cleanup(ctx context.Context) error { return nil }

func (m *testModule3) OnApplicationStart(ctx context.Context) {}
func (m *testModule3) OnApplicationStop(ctx context.Context) {}


type testModule4 struct {}

func (m *testModule4) MyModule() MyModuleInfo {
	return MyModuleInfo{
		ID: "testModule4",
		Priority: utils.Ptr(1),
	}
}
func (m *testModule4) Provision(ctx context.Context) error { return nil }
func (m *testModule4) Cleanup(ctx context.Context) error { return errors.New("test error 4") }

// interface guards
var _ ApplicationStartHook = (*testModule1)(nil)

// registers the applicationStartHook only once
var _ ApplicationStartHook = (*testModule2)(nil)
var _ ApplicationLifecycleHook = (*testModule2)(nil)

var _ ApplicationStartHook = (*testModule3)(nil)
var _ ApplicationStopHook = (*testModule3)(nil)

func TestRegisterMyModule(t *testing.T) {
	t.Parallel()

	m1 := &testModule1{}
	m2 := &testModule2{}
	m3 := &testModule3{}		
	m4 := &testModule4{}
	m5 := &testModule1{}
	t.Run("success", func(t *testing.T) {
		testModuleRegistry := newModuleRegistry()

		testModuleRegistry.registerMyModule(m1)
		testModuleRegistry.registerMyModule(m2)

		require.Equal(t, "testModule1", testModuleRegistry.getMyModules()[0].ID)
		require.Equal(t, "testModule2", testModuleRegistry.getMyModules()[1].ID)
	})

	t.Run("panic_if_module_id_is_empty", func(t *testing.T) {
		testModuleRegistry := newModuleRegistry()

		require.Panics(t, func() {
			testModuleRegistry.registerMyModule(m3)
		})
	})

	t.Run("panic if module new returns nil", func(t *testing.T) {
		testModuleRegistry := newModuleRegistry()

		require.Panics(t, func() {
			testModuleRegistry.registerMyModule(m4)
		})
	})

	t.Run("panic if module id is not unique", func(t *testing.T) {
		testModuleRegistry := newModuleRegistry()

		require.Panics(t, func() {
			testModuleRegistry.registerMyModule(m1)
			testModuleRegistry.registerMyModule(m5)
		})
	})
}

func TestSortMyModules(t *testing.T) {
	t.Parallel()

	module0 := MyModuleInfo{
		ID:       "module0",
		Priority: utils.Ptr(0),
	}

	module1 := MyModuleInfo{
		ID:       "module1",
		Priority: utils.Ptr(1),
	}

	module2 := MyModuleInfo{
		ID:       "module2",
		Priority: utils.Ptr(2),
	}

	module3 := MyModuleInfo{
		ID:  "module3",
		Priority: utils.Ptr(0),
	}

	moduleNilPriority := MyModuleInfo{	
		ID:  "moduleNil",
	}

	t.Run("success", func(t *testing.T) {
		modules := []MyModuleInfo{
			moduleNilPriority,
			module2,
			module0,
			module1,
		}
		result := sortMyModules(modules)

		expected := []MyModuleInfo{
			module0,
			module1,
			module2,
			moduleNilPriority,
		}

		require.EqualValues(t, expected, result)
	})

	t.Run("same priority", func(t *testing.T) {
		modules := []MyModuleInfo{
			module3,
			module0,
		}
		result := sortMyModules(modules)

		expected := []MyModuleInfo{
			module3,
			module0,
		}

		require.EqualValues(t, expected, result)
	})

	t.Run("no modules not panic", func(t *testing.T) {
		modules := []MyModuleInfo{}
		require.Equal(t, []MyModuleInfo{}, sortMyModules(modules))
	})
}

func TestInitMyModules(t *testing.T) {
	t.Parallel()

	t.Run("success", func(t *testing.T) {
		modules := []MyModuleInfo{
		{
			ID: "testModule1",
			New: func() MyModule {
				return &testModule1{}
			},
		},
		{
			ID: "testModule3",
			New: func() MyModule {
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

	// This test verifies that even if a module implements both ApplicationStartHook
	// and ApplicationLifecycleHook (which embeds Start/Stop), the StartHook is registered only once.
	t.Run("success the same hooks are not registered multiple times", func(t *testing.T) {		
		modules := []MyModuleInfo{
		{
			ID: "testModule2",
			New: func() MyModule {
				return &testModule2{}
			},
		},
	}
		cm := newCoreModuleHooks(zaptest.NewLogger(t))	
		err := cm.initCoreModuleHooks(context.Background(), modules)
		require.NoError(t, err)

		require.Equal(t, 1, len(cm.hookRegistry.applicationStartHooks.Values()))
		require.Equal(t, 1, len(cm.hookRegistry.applicationStopHooks.Values()))
	})
}

func TestCleanupMyModules(t *testing.T) {
	t.Parallel()

	t.Run("all modules get chance to cleanup", func(t *testing.T) {
		modules := []MyModuleInfo{
			{
				ID: "testModule1",
				New: func() MyModule {
					return &testModule1{}
				},
			},
			{
				ID: "testModule2",
				New: func() MyModule {
					return &testModule2{}
				},
			},
			{
				ID: "testModule4",
				New: func() MyModule {
					return &testModule4{}
				},
			},
		}
		cm := newCoreModuleHooks(zaptest.NewLogger(t))
		err := cm.initCoreModuleHooks(context.Background(), modules)
		require.NoError(t, err)

		err = cm.cleanupCoreModuleHooks(context.Background())
		require.Error(t, err)
		require.Equal(t, "failed to cleanup module testModule1: test error 1\nfailed to cleanup module testModule4: test error 4", err.Error())
	})
}
