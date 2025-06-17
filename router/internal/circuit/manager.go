package circuit

import (
	"fmt"
	"github.com/cep21/circuit/v4"
	"github.com/cep21/circuit/v4/closers/hystrix"
	"github.com/cep21/circuitotel"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/metric"
)

type Manager struct {
	// We maintain separate circuit breakers for each subgraph
	circuits map[string]*circuit.Circuit
}

func (c *Manager) GetCircuitBreaker(name string) *circuit.Circuit {
	if c == nil {
		return nil
	}

	// Since we should not ever write into a map
	// after the first setup we don't use any read locks
	if circuitBreaker, ok := c.circuits[name]; ok {
		return circuitBreaker
	}
	return nil
}

func (c *Manager) IsEnabled() bool {
	return c != nil && len(c.circuits) > 0
}

func NewManager(
	all *config.CircuitBreaker,
	subgraphCircuitBreakers map[string]*config.CircuitBreaker,
	subgraphs []*nodev1.Subgraph,
	featureFlagName string,
	store metric.Store,
	metricStoreEnabled bool,
) *Manager {
	circuitManager := circuit.Manager{}

	if subgraphCircuitBreakers == nil {
		return &Manager{}
	}

	var f circuitotel.Factory

	isBaseEnabled := all != nil && all.Enabled
	if isBaseEnabled {
		configuration := createConfiguration(all)
		circuitManager.DefaultCircuitProperties = []circuit.CommandPropertiesConstructor{
			configuration.Configure,
			f.CommandPropertiesConstructor,
		}
	}

	circuits := make(map[string]*circuit.Circuit, len(subgraphs))
	for _, sg := range subgraphs {
		// Base graph will start with "::"
		sgCbName := fmt.Sprintf("%s::%s", featureFlagName, sg.Name)

		sgOptions, ok := subgraphCircuitBreakers[sg.Name]
		if !ok && sgOptions == nil {
			// If we have an all option set we can create a circuit breaker for everyone
			if isBaseEnabled {
				circuits[sgCbName] = circuitManager.MustCreateCircuit(sgCbName)
			}
			continue
		}
		newConfig := createConfiguration(sgOptions)
		circuits[sgCbName] = circuitManager.MustCreateCircuit(sgCbName, newConfig.Configure(sgCbName))
	}

	return &Manager{
		circuits: circuits,
	}
}

func createConfiguration(opts *config.CircuitBreaker) hystrix.Factory {
	var configuration = hystrix.Factory{
		ConfigureOpener: hystrix.ConfigureOpener{
			ErrorThresholdPercentage: opts.ErrorThresholdPercentage,
			RequestVolumeThreshold:   opts.RequestThreshold,
			RollingDuration:          opts.RollingDuration,
			NumBuckets:               opts.NumBuckets,
		},
		ConfigureCloser: hystrix.ConfigureCloser{
			SleepWindow:                  opts.SleepWindow,
			HalfOpenAttempts:             opts.HalfOpenAttempts,
			RequiredConcurrentSuccessful: opts.RequiredConcurrentSuccessful,
		},
	}
	return configuration
}
