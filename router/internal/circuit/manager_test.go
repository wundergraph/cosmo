package circuit

import (
	"testing"
	"time"

	"github.com/cep21/circuit/v4"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
)

func TestNewManager(t *testing.T) {
	t.Parallel()

	t.Run("enabled base config", func(t *testing.T) {
		t.Parallel()

		baseConfig := CircuitBreakerConfig{
			Enabled: true,
		}

		manager, err := NewManager(baseConfig)
		require.NoError(t, err)

		require.NotNil(t, manager)
		require.NotNil(t, manager.circuits)
		require.NotNil(t, manager.internalManager)
		require.Equal(t, baseConfig.Enabled, manager.isBaseConfigEnabled)
		require.Empty(t, manager.circuits)
	})

	t.Run("disabled base config", func(t *testing.T) {
		t.Parallel()

		baseConfig := CircuitBreakerConfig{
			Enabled: false,
		}

		manager, err := NewManager(baseConfig)
		require.NoError(t, err)

		require.NotNil(t, manager)
		require.NotNil(t, manager.circuits)
		require.NotNil(t, manager.internalManager)
		require.Equal(t, baseConfig.Enabled, manager.isBaseConfigEnabled)
		require.Empty(t, manager.circuits)
	})

	t.Run("with invalid values", func(t *testing.T) {
		t.Parallel()

		baseConfig := CircuitBreakerConfig{
			Enabled:         true,
			RollingDuration: 10 * time.Second,
			NumBuckets:      7,
		}

		_, err := NewManager(baseConfig)
		require.ErrorContains(t, err, "rolling duration must be divisible by num buckets")
	})
}

func TestManager_GetCircuitBreaker(t *testing.T) {
	t.Parallel()

	t.Run("nil manager", func(t *testing.T) {
		t.Parallel()

		var manager *Manager
		result := manager.GetCircuitBreaker("test-circuit")

		require.Nil(t, result)
	})

	t.Run("existing circuit", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{})
		require.NoError(t, err)
		testCircuit := &circuit.Circuit{}
		manager.AddCircuitBreaker("test-circuit", testCircuit)

		result := manager.GetCircuitBreaker("test-circuit")

		require.NotNil(t, result)
		require.Equal(t, testCircuit, result)
	})

	t.Run("non-existing circuit", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{})
		require.NoError(t, err)
		testCircuit := &circuit.Circuit{}
		manager.AddCircuitBreaker("test-circuit", testCircuit)

		result := manager.GetCircuitBreaker("non-existing")

		require.Nil(t, result)
	})
}

func TestManager_AddCircuitBreaker(t *testing.T) {
	t.Parallel()

	t.Run("nil manager", func(t *testing.T) {
		t.Parallel()

		var manager *Manager
		testCircuit := &circuit.Circuit{}

		require.NotPanics(t, func() {
			manager.AddCircuitBreaker("test-testCircuit", testCircuit)
		})
	})

	t.Run("add circuit", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{})
		require.NoError(t, err)
		testCircuit := &circuit.Circuit{}

		manager.AddCircuitBreaker("test-testCircuit", testCircuit)

		require.Len(t, manager.circuits, 1)
		require.Equal(t, testCircuit, manager.circuits["test-testCircuit"])
	})
}

func TestManager_HasCircuits(t *testing.T) {
	t.Parallel()

	t.Run("nil manager", func(t *testing.T) {
		t.Parallel()

		var manager *Manager
		result := manager.HasCircuits()

		require.False(t, result)
	})

	t.Run("empty circuits", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{})
		require.NoError(t, err)

		result := manager.HasCircuits()

		require.False(t, result)
	})

	t.Run("manager with multiple circuits", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{})
		require.NoError(t, err)

		circuit1 := &circuit.Circuit{}
		circuit2 := &circuit.Circuit{}
		manager.AddCircuitBreaker("test-circuit-1", circuit1)
		manager.AddCircuitBreaker("test-circuit-2", circuit2)

		result := manager.HasCircuits()

		require.True(t, result)
	})
}

func TestManager_Initialize(t *testing.T) {
	t.Parallel()

	t.Run("empty options", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{Enabled: true})
		require.NoError(t, err)

		opts := ManagerOpts{}

		err = manager.Initialize(opts)

		require.NoError(t, err)
		require.Empty(t, manager.circuits)
	})

	t.Run("create circuit for base configuration", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{Enabled: true})
		require.NoError(t, err)

		opts := ManagerOpts{
			SubgraphCircuitBreakers: map[string]CircuitBreakerConfig{},
			AllGroupings: map[string]map[string]bool{
				"http://test-url": {
					"subgraph1": true,
					"subgraph2": true,
				},
				"http://test-url2": {
					"subgraph3": true,
				},
			},
		}
		err = manager.Initialize(opts)

		require.NoError(t, err)
		require.Len(t, manager.circuits, 3)

		s1Cb := manager.GetCircuitBreaker("subgraph1")
		s2Cb := manager.GetCircuitBreaker("subgraph2")
		require.Same(t, s1Cb, s2Cb)

		s3Cb := manager.GetCircuitBreaker("subgraph3")
		require.NotSame(t, s2Cb, s3Cb)
	})

	t.Run("base config disabled when creating circuits", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{Enabled: false})
		require.NoError(t, err)

		opts := ManagerOpts{
			SubgraphCircuitBreakers: map[string]CircuitBreakerConfig{},
			AllGroupings: map[string]map[string]bool{
				"http://test-url": {
					"subgraph1": true,
					"subgraph2": true,
				},
			},
		}

		err = manager.Initialize(opts)

		require.NoError(t, err)
		require.Empty(t, manager.circuits)
	})

	t.Run("custom subgraph circuit breakers", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{Enabled: false})
		require.NoError(t, err)

		opts := ManagerOpts{
			SubgraphCircuitBreakers: map[string]CircuitBreakerConfig{
				"subgraph1": {
					Enabled: true,
				},
				"subgraph2": {
					Enabled: true,
				},
			},
			UseMetrics:         false,
			BaseOtelAttributes: []attribute.KeyValue{},
			AllGroupings: map[string]map[string]bool{
				"http://test-url": {
					"subgraph1": true,
					"subgraph2": true,
					"subgraph3": true,
				},
			},
		}

		err = manager.Initialize(opts)

		require.NoError(t, err)
		require.Len(t, manager.circuits, 2)

		// When using subgraph specific configs we initialize circuit breaker per config
		// even when the url is the same
		s1Cb := manager.GetCircuitBreaker("subgraph1")
		s2Cb := manager.GetCircuitBreaker("subgraph2")
		require.NotSame(t, s1Cb, s2Cb)
	})

	t.Run("mixed default and custom subgraphs", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{Enabled: true})
		require.NoError(t, err)

		opts := ManagerOpts{
			SubgraphCircuitBreakers: map[string]CircuitBreakerConfig{
				"subgraph1": {
					Enabled: true,
				},
			},
			UseMetrics:         false,
			BaseOtelAttributes: []attribute.KeyValue{},
			AllGroupings: map[string]map[string]bool{
				"http://test-url": {
					"subgraph1": true,
					"subgraph2": true,
					"subgraph3": true,
				},
			},
		}

		err = manager.Initialize(opts)

		require.NoError(t, err)
		require.Len(t, manager.circuits, 3)

		s2Cb := manager.GetCircuitBreaker("subgraph2")
		s3Cb := manager.GetCircuitBreaker("subgraph3")
		require.Same(t, s2Cb, s3Cb)
	})

	t.Run("disabled custom subgraph", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{Enabled: true})
		require.NoError(t, err)

		opts := ManagerOpts{
			SubgraphCircuitBreakers: map[string]CircuitBreakerConfig{
				"subgraph2": {
					Enabled: false,
				},
			},
			UseMetrics:         false,
			BaseOtelAttributes: []attribute.KeyValue{},
			AllGroupings: map[string]map[string]bool{
				"http://test-url": {
					"subgraph1": true,
					"subgraph2": true,
				},
			},
		}

		err = manager.Initialize(opts)

		require.NoError(t, err)
		require.Len(t, manager.circuits, 1) // Only subgraph1 should be added

		s2Cb := manager.GetCircuitBreaker("subgraph2")
		require.Nil(t, s2Cb)
	})

	t.Run("with invalid values", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{Enabled: false})
		require.NoError(t, err)

		opts := ManagerOpts{
			SubgraphCircuitBreakers: map[string]CircuitBreakerConfig{
				"subgraph1": {
					Enabled:         true,
					RollingDuration: 10 * time.Second,
					NumBuckets:      7,
				},
			},
			UseMetrics:         false,
			BaseOtelAttributes: []attribute.KeyValue{},
			AllGroupings: map[string]map[string]bool{
				"http://test-url": {
					"subgraph1": true,
					"subgraph2": true,
					"subgraph3": true,
				},
			},
		}

		err = manager.Initialize(opts)
		require.ErrorContains(t, err, "rolling duration must be divisible by num buckets")
	})

	t.Run("multiple routing URLs", func(t *testing.T) {
		t.Parallel()

		manager, err := NewManager(CircuitBreakerConfig{Enabled: true})
		require.NoError(t, err)

		opts := ManagerOpts{
			SubgraphCircuitBreakers: map[string]CircuitBreakerConfig{},
			UseMetrics:              false,
			BaseOtelAttributes:      []attribute.KeyValue{},
			AllGroupings: map[string]map[string]bool{
				"http://test-url-1": {
					"subgraph1": true,
				},
				"http://test-url-2": {
					"subgraph2": true,
				},
			},
		}

		err = manager.Initialize(opts)

		require.NoError(t, err)
		require.Len(t, manager.circuits, 2)
	})

}
