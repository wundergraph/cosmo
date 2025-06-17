package core

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockHook interface {
	Do(ctx context.Context) error
}

type mockHookImpl struct {
	id        string
	shouldErr bool
}

func (m *mockHookImpl) Do(ctx context.Context) error {
	if m.shouldErr {
		return fmt.Errorf("hook %s failed", m.id)
	}
	return nil
}

func TestExecuteHooks(t *testing.T) {
	ctx := context.Background()

	t.Run("all hooks succeed", func(t *testing.T) {
		hooks := []moduleHook[mockHook]{
			{ID: "module1", Hook: &mockHookImpl{id: "hook1"}},
			{ID: "module2", Hook: &mockHookImpl{id: "hook2"}},
		}

		err := executeHooks(ctx, hooks, func(h mockHook) error {
			return h.Do(ctx)
		}, "MockHook")

		require.NoError(t, err)
	})

	t.Run("one hook fails", func(t *testing.T) {
		hooks := []moduleHook[mockHook]{
			{ID: "module1", Hook: &mockHookImpl{id: "hook1"}},
			{ID: "moduleFail", Hook: &mockHookImpl{id: "hook2", shouldErr: true}},
			{ID: "module3", Hook: &mockHookImpl{id: "hook3"}},
		}

		err := executeHooks(ctx, hooks, func(h mockHook) error {
			return h.Do(ctx)
		}, "MockHook")

		require.Error(t, err)

		assert.Equal(t, err.Error(), "failed to run hook MockHook of module moduleFail: hook hook2 failed")
	})

	t.Run("empty hook list", func(t *testing.T) {
		var hooks []moduleHook[mockHook]

		err := executeHooks(ctx, hooks, func(h mockHook) error {
			return h.Do(ctx)
		}, "MockHook")

		require.NoError(t, err)
	})
}
