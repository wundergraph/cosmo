package testenv

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestEnvironmentWithTOverridesTestContext(t *testing.T) {
	t.Parallel()

	parent := &Environment{t: t}

	t.Run("child", func(child *testing.T) {
		child.Parallel()

		cloned := parent.WithT(child)
		require.Same(t, child, cloned.t)
		require.Same(t, t, parent.t)
	})
}
